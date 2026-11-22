import { getClient } from '../../config/db.js';
import { warehousesRepository } from './warehouses.repository.js';
import { roundMoney, TRANSFER_STATUS } from './warehouses.constants.js';

class WarehousesService {
  async getWarehouses(filters = {}) {
    return warehousesRepository.findAllWarehouses(filters);
  }

  async getWarehouseById(id) {
    const wh = await warehousesRepository.findWarehouseById(id);
    if (!wh) {
      const err = new Error(`Warehouse with ID ${id} not found`);
      err.statusCode = 404;
      throw err;
    }
    return wh;
  }

  async createWarehouse(data) {
    const existing = await warehousesRepository.findWarehouseByCode(data.warehouse_code);
    if (existing) {
      const err = new Error(`Warehouse with code "${data.warehouse_code}" already exists`);
      err.statusCode = 409;
      throw err;
    }
    return warehousesRepository.createWarehouse(data);
  }

  async updateWarehouse(id, data) {
    const wh = await warehousesRepository.findWarehouseById(id);
    if (!wh) {
      const err = new Error(`Warehouse with ID ${id} not found`);
      err.statusCode = 404;
      throw err;
    }
    return warehousesRepository.updateWarehouse(id, data);
  }

  async getWarehouseStock(warehouseId) {
    await this.getWarehouseById(warehouseId);
    return warehousesRepository.getWarehouseStock(warehouseId);
  }

  async getWarehouseValuation(warehouseId) {
    await this.getWarehouseById(warehouseId);
    const summary = await warehousesRepository.getWarehouseValuation(warehouseId);
    return summary || {
      warehouse_id: warehouseId,
      items_in_stock: 0,
      total_units: 0,
      total_valuation: 0,
    };
  }

  // ============================================================================
  // TRANSFERS LIFECYCLE
  // ============================================================================

  async createTransfer(data, user) {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const srcWh = await warehousesRepository.findWarehouseById(data.source_warehouse_id, client);
      if (!srcWh) {
        const err = new Error('Source warehouse not found');
        err.statusCode = 404;
        throw err;
      }

      const destWh = await warehousesRepository.findWarehouseById(data.destination_warehouse_id, client);
      if (!destWh) {
        const err = new Error('Destination warehouse not found');
        err.statusCode = 404;
        throw err;
      }

      const transferNumber = await warehousesRepository.generateTransferNumber(data.transfer_date, client);

      const itemsWithCost = [];
      for (const item of data.items) {
        // Resolve conversion to base quantity
        const uomRes = await client.query(`SELECT fn_compute_base_quantity($1, $2, $3) AS base_qty`, [
          item.item_id,
          item.requested_qty,
          item.uom_id,
        ]);
        const baseQty = Number(uomRes.rows[0].base_qty);

        // Get current moving WAC
        const balRes = await client.query(`SELECT current_moving_wac FROM item_stock_balances WHERE item_id = $1`, [item.item_id]);
        const wac = Number(balRes.rows[0]?.current_moving_wac) || 0;

        itemsWithCost.push({
          ...item,
          base_quantity: baseQty,
          unit_cost: wac,
          total_cost: roundMoney(baseQty * wac),
        });
      }

      const transfer = await warehousesRepository.createTransfer(
        {
          ...data,
          transfer_number: transferNumber,
          requested_by: user.id,
        },
        itemsWithCost,
        client
      );

      await client.query('COMMIT');
      return warehousesRepository.findTransferById(transfer.id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async approveTransfer(id, user) {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const transfer = await warehousesRepository.findTransferById(id, client);
      if (!transfer) {
        const err = new Error(`Transfer with ID ${id} not found`);
        err.statusCode = 404;
        throw err;
      }

      if (transfer.status !== TRANSFER_STATUS.REQUESTED) {
        const err = new Error(`Only requested transfers can be approved. Current status: "${transfer.status}"`);
        err.statusCode = 400;
        throw err;
      }

      await client.query(
        `UPDATE warehouse_transfers 
         SET status = $1, approved_by = $2, approved_at = NOW(), updated_at = NOW() 
         WHERE id = $3`,
        [TRANSFER_STATUS.APPROVED, user.id, id]
      );

      await client.query('COMMIT');
      return warehousesRepository.findTransferById(id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async dispatchTransfer(id, user) {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const transfer = await warehousesRepository.findTransferById(id, client);
      if (!transfer) {
        const err = new Error(`Transfer with ID ${id} not found`);
        err.statusCode = 404;
        throw err;
      }

      if (transfer.status !== TRANSFER_STATUS.APPROVED) {
        const err = new Error(`Only approved transfers can be dispatched. Current status: "${transfer.status}"`);
        err.statusCode = 400;
        throw err;
      }

      for (const item of transfer.items) {
        // Check source warehouse stock
        const stockRes = await client.query(
          `SELECT COALESCE(SUM(base_quantity_delta), 0.0000) AS available_qty
           FROM inventory_ledger
           WHERE warehouse_id = $1 AND item_id = $2`,
          [transfer.source_warehouse_id, item.item_id]
        );
        const available = Number(stockRes.rows[0]?.available_qty) || 0;

        if (available < Number(item.base_quantity)) {
          const err = new Error(
            `Transfer Dispatch Rejected: Insufficient stock in source warehouse (${transfer.source_warehouse_code}). Available: ${available}, Required: ${item.base_quantity}.`
          );
          err.statusCode = 400;
          throw err;
        }

        // Atomically post WAREHOUSE_TRANSFER_OUT to immutable inventory ledger
        await client.query(
          `INSERT INTO inventory_ledger (
            item_id,
            warehouse_id,
            batch_number,
            movement_type,
            transaction_qty,
            transaction_uom_id,
            base_quantity_delta,
            unit_cost,
            total_cost,
            warehouse_transfer_item_id,
            source_reference_label,
            created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            item.item_id,
            transfer.source_warehouse_id,
            item.batch_number || null,
            'WAREHOUSE_TRANSFER_OUT',
            item.requested_qty,
            item.uom_id,
            -Number(item.base_quantity),
            item.unit_cost,
            -roundMoney(Number(item.base_quantity) * Number(item.unit_cost)),
            item.id,
            transfer.transfer_number,
            user.id,
          ]
        );

        // Update dispatched_qty on transfer item
        await client.query(
          `UPDATE warehouse_transfer_items 
           SET dispatched_qty = requested_qty 
           WHERE id = $1`,
          [item.id]
        );
      }

      // Update transfer header to in_transit
      await client.query(
        `UPDATE warehouse_transfers 
         SET status = $1, dispatched_by = $2, dispatched_at = NOW(), updated_at = NOW() 
         WHERE id = $3`,
        [TRANSFER_STATUS.IN_TRANSIT, user.id, id]
      );

      await client.query('COMMIT');
      return warehousesRepository.findTransferById(id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async receiveTransfer(id, data, user) {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const transfer = await warehousesRepository.findTransferById(id, client);
      if (!transfer) {
        const err = new Error(`Transfer with ID ${id} not found`);
        err.statusCode = 404;
        throw err;
      }

      if (transfer.status !== TRANSFER_STATUS.IN_TRANSIT) {
        const err = new Error(`Only in-transit transfers can be received. Current status: "${transfer.status}"`);
        err.statusCode = 400;
        throw err;
      }

      for (const recItem of data.items) {
        const item = transfer.items.find((i) => i.id === recItem.transfer_item_id);
        if (!item) {
          const err = new Error(`Transfer item ${recItem.transfer_item_id} not found on this transfer`);
          err.statusCode = 400;
          throw err;
        }

        const receivedQty = Number(recItem.received_qty);
        if (receivedQty > Number(item.dispatched_qty)) {
          const err = new Error(`Received quantity (${receivedQty}) cannot exceed dispatched quantity (${item.dispatched_qty})`);
          err.statusCode = 400;
          throw err;
        }

        // Convert received qty to base quantity
        const uomRes = await client.query(`SELECT fn_compute_base_quantity($1, $2, $3) AS base_qty`, [
          item.item_id,
          receivedQty,
          item.uom_id,
        ]);
        const receivedBaseQty = Number(uomRes.rows[0].base_qty);

        // Atomically post WAREHOUSE_TRANSFER_IN to destination warehouse
        await client.query(
          `INSERT INTO inventory_ledger (
            item_id,
            warehouse_id,
            batch_number,
            movement_type,
            transaction_qty,
            transaction_uom_id,
            base_quantity_delta,
            unit_cost,
            total_cost,
            warehouse_transfer_item_id,
            source_reference_label,
            created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            item.item_id,
            transfer.destination_warehouse_id,
            item.batch_number || null,
            'WAREHOUSE_TRANSFER_IN',
            receivedQty,
            item.uom_id,
            receivedBaseQty,
            item.unit_cost,
            roundMoney(receivedBaseQty * Number(item.unit_cost)),
            item.id,
            transfer.transfer_number,
            user.id,
          ]
        );

        // Update received_qty
        await client.query(
          `UPDATE warehouse_transfer_items 
           SET received_qty = $1 
           WHERE id = $2`,
          [receivedQty, item.id]
        );
      }

      // Mark transfer received
      await client.query(
        `UPDATE warehouse_transfers 
         SET status = $1, received_by = $2, received_at = NOW(), updated_at = NOW() 
         WHERE id = $3`,
        [TRANSFER_STATUS.RECEIVED, user.id, id]
      );

      await client.query('COMMIT');
      return warehousesRepository.findTransferById(id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async cancelTransfer(id, data, user) {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const transfer = await warehousesRepository.findTransferById(id, client);
      if (!transfer) {
        const err = new Error(`Transfer with ID ${id} not found`);
        err.statusCode = 404;
        throw err;
      }

      if (transfer.status === TRANSFER_STATUS.RECEIVED) {
        const err = new Error('Cannot cancel a received transfer');
        err.statusCode = 400;
        throw err;
      }

      if (transfer.status === TRANSFER_STATUS.CANCELLED) {
        const err = new Error('Transfer is already cancelled');
        err.statusCode = 400;
        throw err;
      }

      // If in transit, restore stock back to source warehouse
      if (transfer.status === TRANSFER_STATUS.IN_TRANSIT) {
        for (const item of transfer.items) {
          await client.query(
            `INSERT INTO inventory_ledger (
              item_id,
              warehouse_id,
              batch_number,
              movement_type,
              transaction_qty,
              transaction_uom_id,
              base_quantity_delta,
              unit_cost,
              total_cost,
              warehouse_transfer_item_id,
              source_reference_label,
              created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              item.item_id,
              transfer.source_warehouse_id,
              item.batch_number || null,
              'WAREHOUSE_TRANSFER_IN',
              item.dispatched_qty,
              item.uom_id,
              Number(item.base_quantity),
              item.unit_cost,
              roundMoney(Number(item.base_quantity) * Number(item.unit_cost)),
              item.id,
              `CANCEL-${transfer.transfer_number}`,
              user.id,
            ]
          );
        }
      }

      await client.query(
        `UPDATE warehouse_transfers 
         SET status = $1, cancelled_by = $2, cancelled_at = NOW(), cancellation_reason = $3, updated_at = NOW() 
         WHERE id = $4`,
        [TRANSFER_STATUS.CANCELLED, user.id, data.cancellation_reason, id]
      );

      await client.query('COMMIT');
      return warehousesRepository.findTransferById(id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getTransfers(filters = {}) {
    return warehousesRepository.findTransfers(filters);
  }

  async getTransferById(id) {
    const transfer = await warehousesRepository.findTransferById(id);
    if (!transfer) {
      const err = new Error(`Transfer with ID ${id} not found`);
      err.statusCode = 404;
      throw err;
    }
    return transfer;
  }
}

export const warehousesService = new WarehousesService();
