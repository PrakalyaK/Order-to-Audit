import { salesOrdersRepository } from './sales-orders.repository.js';
import { SALES_ORDER_STATUS } from './sales-orders.constants.js';
import { ROLES } from '../auth/auth.constants.js';
import { ApiError } from '../../utils/ApiError.js';
import { query } from '../../config/db.js';

export const salesOrdersService = {
  /**
   * Create a new sales order with validations and finished good constraints
   */
  async createSalesOrder(orderData, user) {
    // 1. Validate customer party
    const partyRes = await query(
      `SELECT id, trade_name, party_type, state_code, state_name, is_active 
       FROM parties 
       WHERE id = $1;`,
      [orderData.customerId]
    );

    if (partyRes.rows.length === 0) {
      throw ApiError.notFound('Customer party not found');
    }

    const customer = partyRes.rows[0];
    if (!customer.is_active) {
      throw ApiError.badRequest(`Customer "${customer.trade_name}" is inactive`);
    }

    if (customer.party_type !== 'customer' && customer.party_type !== 'both') {
      throw ApiError.badRequest(`Party "${customer.trade_name}" is a supplier and cannot be used as a customer`);
    }

    // 2. Resolve salesman
    let salesmanId = user.id;
    if (user.role === ROLES.SALESMAN) {
      salesmanId = user.id;
    } else if (orderData.salesmanId) {
      const salesmanRes = await query(`SELECT id, role, is_active FROM users WHERE id = $1;`, [orderData.salesmanId]);
      if (salesmanRes.rows.length === 0 || !salesmanRes.rows[0].is_active) {
        throw ApiError.badRequest('Specified salesman user is invalid or inactive');
      }
      salesmanId = orderData.salesmanId;
    }

    // 3. Validate items (must be active finished goods)
    const itemIds = orderData.items.map((i) => i.itemId);
    const itemsRes = await query(
      `SELECT i.id, i.sku, i.name, i.item_type, i.base_uom_id, i.hsn_code, i.gst_rate_pct, 
              i.standard_selling_price, i.is_active,
              COALESCE(isb.current_base_qty, 0.0000) AS available_base_qty
       FROM items i
       LEFT JOIN item_stock_balances isb ON i.id = isb.item_id
       WHERE i.id = ANY($1::uuid[]);`,
      [itemIds]
    );

    const itemMap = new Map();
    itemsRes.rows.forEach((it) => itemMap.set(it.id, it));

    let subtotal = 0;
    let estimatedTax = 0;
    const validatedItems = [];
    const stockWarnings = [];

    for (const itemInput of orderData.items) {
      const dbItem = itemMap.get(itemInput.itemId);
      if (!dbItem) {
        throw ApiError.notFound(`Item ${itemInput.itemId} not found`);
      }
      if (!dbItem.is_active) {
        throw ApiError.badRequest(`Item "${dbItem.name}" (${dbItem.sku}) is inactive`);
      }
      if (dbItem.item_type !== 'finished_good') {
        throw ApiError.badRequest(
          `Item "${dbItem.name}" (${dbItem.sku}) is of type "${dbItem.item_type}". Only finished goods can be ordered via Sales Orders.`
        );
      }

      const uomId = itemInput.uomId || dbItem.base_uom_id;
      const unitPrice = itemInput.unitPrice !== undefined ? Number(itemInput.unitPrice) : Number(dbItem.standard_selling_price);
      const orderedQty = Number(itemInput.orderedQty);

      if (unitPrice < 0) {
        throw ApiError.badRequest(`Unit price for item "${dbItem.name}" cannot be negative`);
      }

      const taxableValue = Math.round(orderedQty * unitPrice * 100) / 100;
      const gstRate = Number(dbItem.gst_rate_pct);
      const itemTax = Math.round(taxableValue * (gstRate / 100) * 100) / 100;
      const totalItemValue = Math.round((taxableValue + itemTax) * 100) / 100;

      subtotal += taxableValue;
      estimatedTax += itemTax;

      // Check stock availability
      const availableQty = Number(dbItem.available_base_qty);
      if (orderedQty > availableQty) {
        stockWarnings.push({
          itemId: dbItem.id,
          sku: dbItem.sku,
          name: dbItem.name,
          orderedQty,
          availableStock: availableQty,
          shortageQty: Math.round((orderedQty - availableQty) * 10000) / 10000,
        });
      }

      validatedItems.push({
        item_id: dbItem.id,
        item_name_snapshot: dbItem.name,
        hsn_code_snapshot: dbItem.hsn_code,
        ordered_qty: orderedQty,
        approved_qty: null,
        uom_id: uomId,
        unit_price: unitPrice,
        gst_rate_pct: gstRate,
        taxable_value: taxableValue,
        total_item_value: totalItemValue,
      });
    }

    subtotal = Math.round(subtotal * 100) / 100;
    estimatedTax = Math.round(estimatedTax * 100) / 100;
    const totalOrderValue = Math.round((subtotal + estimatedTax) * 100) / 100;

    const orderDate = orderData.orderDate || new Date().toISOString().split('T')[0];
    const orderNumber = await salesOrdersRepository.generateOrderNumber(orderDate);

    const createdOrder = await salesOrdersRepository.createWithItems(
      {
        order_number: orderNumber,
        customer_id: customer.id,
        salesman_id: salesmanId,
        order_date: orderDate,
        offline_client_uuid: orderData.offlineClientUuid || null,
        status: SALES_ORDER_STATUS.SUBMITTED,
        subtotal_amount: subtotal,
        estimated_tax_amount: estimatedTax,
        total_order_value: totalOrderValue,
        notes: orderData.notes || null,
      },
      validatedItems
    );

    return {
      ...createdOrder,
      stockAvailability: {
        isFullyInStock: stockWarnings.length === 0,
        warnings: stockWarnings,
      },
    };
  },

  /**
   * List paginated sales orders with RBAC enforcement
   */
  async getSalesOrders(filters, user) {
    const queryFilters = { ...filters };
    if (user.role === ROLES.SALESMAN) {
      queryFilters.salesmanId = user.id;
    }
    return salesOrdersRepository.findAll(queryFilters);
  },

  /**
   * Get sales order by ID with stock availability check
   */
  async getSalesOrderById(id, user) {
    const order = await salesOrdersRepository.findById(id);
    if (!order) {
      throw ApiError.notFound('Sales order not found');
    }

    if (user.role === ROLES.SALESMAN && order.salesman_id !== user.id) {
      throw ApiError.forbidden('Access denied: You can only view your own sales orders');
    }

    return order;
  },

  /**
   * Update sales order in submitted status
   */
  async updateSalesOrder(id, updateData, user) {
    const order = await salesOrdersRepository.findById(id);
    if (!order) {
      throw ApiError.notFound('Sales order not found');
    }

    if (order.status !== SALES_ORDER_STATUS.SUBMITTED) {
      throw ApiError.badRequest(`Cannot edit sales order in status "${order.status}". Only submitted orders can be updated.`);
    }

    if (user.role === ROLES.SALESMAN && order.salesman_id !== user.id) {
      throw ApiError.forbidden('Access denied: You can only edit your own sales orders');
    }

    let subtotal = Number(order.subtotal_amount);
    let estimatedTax = Number(order.estimated_tax_amount);
    let totalOrderValue = Number(order.total_order_value);
    let validatedItems = null;

    if (updateData.items && updateData.items.length > 0) {
      const itemIds = updateData.items.map((i) => i.itemId);
      const itemsRes = await query(
        `SELECT id, sku, name, item_type, base_uom_id, hsn_code, gst_rate_pct, standard_selling_price, is_active 
         FROM items 
         WHERE id = ANY($1::uuid[]);`,
        [itemIds]
      );

      const itemMap = new Map();
      itemsRes.rows.forEach((it) => itemMap.set(it.id, it));

      subtotal = 0;
      estimatedTax = 0;
      validatedItems = [];

      for (const itemInput of updateData.items) {
        const dbItem = itemMap.get(itemInput.itemId);
        if (!dbItem) {
          throw ApiError.notFound(`Item ${itemInput.itemId} not found`);
        }
        if (!dbItem.is_active) {
          throw ApiError.badRequest(`Item "${dbItem.name}" is inactive`);
        }
        if (dbItem.item_type !== 'finished_good') {
          throw ApiError.badRequest(`Item "${dbItem.name}" is not a finished good`);
        }

        const uomId = itemInput.uomId || dbItem.base_uom_id;
        const unitPrice = itemInput.unitPrice !== undefined ? Number(itemInput.unitPrice) : Number(dbItem.standard_selling_price);
        const orderedQty = Number(itemInput.orderedQty);

        const taxableValue = Math.round(orderedQty * unitPrice * 100) / 100;
        const gstRate = Number(dbItem.gst_rate_pct);
        const itemTax = Math.round(taxableValue * (gstRate / 100) * 100) / 100;
        const totalItemValue = Math.round((taxableValue + itemTax) * 100) / 100;

        subtotal += taxableValue;
        estimatedTax += itemTax;

        validatedItems.push({
          item_id: dbItem.id,
          item_name_snapshot: dbItem.name,
          hsn_code_snapshot: dbItem.hsn_code,
          ordered_qty: orderedQty,
          approved_qty: null,
          uom_id: uomId,
          unit_price: unitPrice,
          gst_rate_pct: gstRate,
          taxable_value: taxableValue,
          total_item_value: totalItemValue,
        });
      }

      subtotal = Math.round(subtotal * 100) / 100;
      estimatedTax = Math.round(estimatedTax * 100) / 100;
      totalOrderValue = Math.round((subtotal + estimatedTax) * 100) / 100;
    }

    return salesOrdersRepository.updateWithItems(
      id,
      {
        subtotal_amount: subtotal,
        estimated_tax_amount: estimatedTax,
        total_order_value: totalOrderValue,
        notes: updateData.notes !== undefined ? updateData.notes : order.notes,
      },
      validatedItems
    );
  },

  /**
   * Approve sales order (Owner / Factory Admin)
   */
  async approveSalesOrder(id, { items } = {}, user) {
    const order = await salesOrdersRepository.findById(id);
    if (!order) {
      throw ApiError.notFound('Sales order not found');
    }

    if (order.status !== SALES_ORDER_STATUS.SUBMITTED) {
      throw ApiError.badRequest(`Cannot approve sales order in status "${order.status}". Only submitted orders can be approved.`);
    }

    // Process line-item approvals
    const approvalList = [];
    if (items && items.length > 0) {
      const orderItemMap = new Map(order.items.map((i) => [i.item_id, i]));
      for (const approval of items) {
        const orderItem = orderItemMap.get(approval.itemId);
        if (!orderItem) {
          throw ApiError.badRequest(`Item ${approval.itemId} does not belong to this sales order`);
        }
        if (approval.approvedQty > Number(orderItem.ordered_qty)) {
          throw ApiError.badRequest(
            `Approved quantity (${approval.approvedQty}) cannot exceed ordered quantity (${orderItem.ordered_qty}) for item "${orderItem.item_name_snapshot}"`
          );
        }
        approvalList.push({
          itemId: approval.itemId,
          approvedQty: approval.approvedQty,
        });
      }
    } else {
      // Default: approve full ordered quantity
      order.items.forEach((it) => {
        approvalList.push({
          itemId: it.item_id,
          approvedQty: Number(it.ordered_qty),
        });
      });
    }

    await salesOrdersRepository.updateApprovedQuantities(id, approvalList);
    const updated = await salesOrdersRepository.updateStatus(id, SALES_ORDER_STATUS.APPROVED);
    return salesOrdersRepository.findById(id);
  },

  /**
   * Reject sales order with reason (Owner / Factory Admin)
   */
  async rejectSalesOrder(id, rejectionReason, user) {
    const order = await salesOrdersRepository.findById(id);
    if (!order) {
      throw ApiError.notFound('Sales order not found');
    }

    if (order.status !== SALES_ORDER_STATUS.SUBMITTED) {
      throw ApiError.badRequest(`Cannot reject sales order in status "${order.status}". Only submitted orders can be rejected.`);
    }

    return salesOrdersRepository.updateStatus(id, SALES_ORDER_STATUS.REJECTED, {
      rejection_reason: rejectionReason,
    });
  },

  /**
   * Cancel sales order (Salesman for own submitted, or Admin/Owner)
   */
  async cancelSalesOrder(id, user) {
    const order = await salesOrdersRepository.findById(id);
    if (!order) {
      throw ApiError.notFound('Sales order not found');
    }

    if (order.status === SALES_ORDER_STATUS.INVOICED || order.status === SALES_ORDER_STATUS.DISPATCHED) {
      throw ApiError.badRequest(
        `Integrity Violation: Cannot cancel sales order in status "${order.status}" as commercial or dispatch commitments exist.`
      );
    }

    if (order.status === SALES_ORDER_STATUS.CANCELLED) {
      throw ApiError.badRequest('Sales order is already cancelled');
    }

    if (user.role === ROLES.SALESMAN && order.salesman_id !== user.id) {
      throw ApiError.forbidden('Access denied: You can only cancel your own sales orders');
    }

    return salesOrdersRepository.updateStatus(id, SALES_ORDER_STATUS.CANCELLED);
  },
};
