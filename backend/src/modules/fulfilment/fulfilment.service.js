import { fulfilmentRepository } from './fulfilment.repository.js';
import { bomsRepository } from '../boms/boms.repository.js';
import { bomsService } from '../boms/boms.service.js';
import { itemsRepository } from '../items/items.repository.js';
import { purchasesService } from '../purchases/purchases.service.js';
import { productionService } from '../production/production.service.js';
import { invoicesRepository } from '../invoices/invoices.repository.js';
import { dispatchesRepository } from '../dispatches/dispatches.repository.js';
import { FULFILMENT_STATUS, PRODUCTION_REQUIREMENT_STATUS } from './fulfilment.constants.js';
import { ROLES } from '../auth/auth.constants.js';
import { ApiError } from '../../utils/ApiError.js';
import { getClient, query } from '../../config/db.js';
import { getFinancialYear } from '../invoices/invoices.constants.js';

export const fulfilmentService = {
  /**
   * Evaluate a Sales Order's fulfilment status against live finished goods stock
   * and auto-generate or update production requirements and notifications.
   */
  async evaluateSalesOrder(salesOrderId, client = null) {
    const runner = client || { query };

    const orderRes = await runner.query(
      `SELECT so.*, p.trade_name AS customer_name 
       FROM sales_orders so 
       JOIN parties p ON so.customer_id = p.id 
       WHERE so.id = $1;`,
      [salesOrderId]
    );

    if (orderRes.rows.length === 0) {
      throw ApiError.notFound('Sales order not found');
    }

    const order = orderRes.rows[0];

    // Only approved, invoiced, or partially dispatched orders are in fulfilment
    if (!['approved', 'invoiced', 'partially_dispatched'].includes(order.status)) {
      return {
        salesOrderId,
        status: order.status,
        message: `Sales order ${order.order_number} is in status "${order.status}" and not yet eligible for fulfilment evaluation.`,
        lines: [],
      };
    }

    const lines = await fulfilmentRepository.findSalesOrderFulfilment(salesOrderId, runner);

    const generatedRequirements = [];
    let overallShortage = 0;
    let overallRemaining = 0;

    for (const line of lines) {
      const remainingQty = parseFloat(line.remaining_qty || 0);
      const availableStock = parseFloat(line.available_stock_qty || 0);
      const shortageQty = Math.max(0, remainingQty - availableStock);

      overallRemaining += remainingQty;
      overallShortage += shortageQty;

      if (shortageQty > 0) {
        // Auto-generate or update active Production Requirement
        const { requirement, isNew } = await fulfilmentRepository.upsertProductionRequirement(
          {
            sales_order_id: salesOrderId,
            product_id: line.item_id,
            required_qty: remainingQty,
            available_qty_at_creation: availableStock,
            production_qty_required: shortageQty,
            notes: `Auto-generated from Order Fulfilment: SO #${order.order_number} shortage of ${shortageQty} ${line.uom_id}`,
          },
          runner
        );

        generatedRequirements.push(requirement);

        // Generate in-app notifications if new requirement created
        if (isNew) {
          await fulfilmentRepository.createNotification(
            {
              recipient_role: ROLES.PRODUCTION_SUPERVISOR,
              title: `Production Required: SO #${order.order_number}`,
              message: `Shortage detected for ${line.product_name}: Required ${shortageQty} ${line.uom_id} to fulfil ${order.customer_name}'s order.`,
              entity_type: 'production_requirement',
              entity_id: requirement.id,
              action_url: `/sales/fulfilment`,
            },
            runner
          );

          await fulfilmentRepository.createNotification(
            {
              recipient_role: ROLES.FACTORY_ADMIN,
              title: `Production Requirement Created: ${requirement.requirement_number}`,
              message: `Order #${order.order_number} requires production of ${shortageQty} ${line.uom_id} of ${line.product_name}.`,
              entity_type: 'production_requirement',
              entity_id: requirement.id,
              action_url: `/sales/fulfilment`,
            },
            runner
          );
        }
      } else {
        // Shortage is 0: if an active requirement was pending, mark it fulfilled
        const existingReq = await fulfilmentRepository.findActiveRequirement(salesOrderId, line.item_id, runner);
        if (existingReq && existingReq.status === 'pending_production_review') {
          await fulfilmentRepository.updateRequirementStatus(
            existingReq.id,
            PRODUCTION_REQUIREMENT_STATUS.FULFILLED,
            { fulfilled_qty: existingReq.production_qty_required },
            runner
          );
        }
      }
    }

    const overallStatus =
      overallRemaining <= 0
        ? FULFILMENT_STATUS.FULFILLED
        : overallShortage === 0
        ? FULFILMENT_STATUS.READY_TO_DISPATCH
        : overallShortage < overallRemaining
        ? FULFILMENT_STATUS.PARTIALLY_AVAILABLE
        : FULFILMENT_STATUS.STOCK_SHORTAGE;

    return {
      salesOrderId,
      orderNumber: order.order_number,
      customerName: order.customer_name,
      overallStatus,
      totalRemainingQty: overallRemaining,
      totalShortageQty: overallShortage,
      lines,
      productionRequirements: generatedRequirements,
    };
  },

  /**
   * Get fulfilment dashboard summary & paginated order list
   */
  async getFulfilmentDashboard(queryParams, user) {
    const summary = await fulfilmentRepository.getFulfilmentSummary();
    const result = await fulfilmentRepository.findFulfilmentOrders(queryParams);

    return {
      summary,
      ...result,
    };
  },

  /**
   * Get detailed single order fulfilment
   */
  async getSalesOrderFulfilment(salesOrderId, user) {
    await this.evaluateSalesOrder(salesOrderId);
    const lines = await fulfilmentRepository.findSalesOrderFulfilment(salesOrderId);

    if (lines.length === 0) {
      throw ApiError.notFound('No fulfilment lines found for this sales order');
    }

    const first = lines[0];
    const totalRemaining = lines.reduce((s, l) => s + parseFloat(l.remaining_qty || 0), 0);
    const totalShortage = lines.reduce((s, l) => s + parseFloat(l.shortage_qty || 0), 0);

    const overallStatus =
      totalRemaining <= 0
        ? FULFILMENT_STATUS.FULFILLED
        : totalShortage === 0
        ? FULFILMENT_STATUS.READY_TO_DISPATCH
        : totalShortage < totalRemaining
        ? FULFILMENT_STATUS.PARTIALLY_AVAILABLE
        : FULFILMENT_STATUS.STOCK_SHORTAGE;

    return {
      salesOrderId: first.sales_order_id,
      orderNumber: first.order_number,
      orderDate: first.order_date,
      orderStatus: first.order_status,
      customerName: first.customer_name,
      customerStateName: first.customer_state_name,
      overallStatus,
      totalRemainingQty: totalRemaining,
      totalShortageQty: totalShortage,
      items: lines,
    };
  },

  /**
   * Get list of production requirements with filters
   */
  async getProductionRequirements(queryParams, user) {
    return await fulfilmentRepository.findProductionRequirements(queryParams);
  },

  /**
   * Get production requirement details including linked BOM and raw material stock verification
   */
  async getProductionRequirementDetails(id, user) {
    const requirement = await fulfilmentRepository.findProductionRequirementById(id);
    if (!requirement) {
      throw ApiError.notFound(`Production requirement '${id}' not found`);
    }

    const bomHeader = await bomsRepository.findActiveByProductId(requirement.product_id);
    if (!bomHeader) {
      return {
        requirement,
        bom: null,
        materials: [],
        allMaterialsAvailable: false,
        message: 'No active BOM found for this finished good product',
        procurementRequirements: [],
      };
    }
    const bom = await bomsRepository.findById(bomHeader.id);

    const reqOutputQty = parseFloat(requirement.production_qty_required);
    const bomCalc = await bomsService.calculateRequirements(bom.id, reqOutputQty, bom.batch_uom_id);
    const procRequirements = await fulfilmentRepository.findProcurementRequirementsByProductionReqId(id);

    return {
      requirement,
      bom: {
        id: bom.id,
        bom_code: bom.bom_code,
        version_number: bom.version_number,
        standard_batch_size: bom.standard_batch_size,
        batch_uom_id: bom.batch_uom_id,
        tolerance_variance_pct: bom.tolerance_variance_pct,
      },
      materials: bomCalc.materials.map((m) => ({
        ...m,
        material_item_id: m.item_id,
        sku: m.item_sku,
        standard_quantity: m.standard_qty_per_batch,
        total_required_quantity: m.total_required_qty,
        available_stock: m.available_stock_qty,
        shortage_quantity: m.shortage_qty,
      })),
      allMaterialsAvailable: bomCalc.all_materials_available,
      batchesNeeded: Math.ceil(reqOutputQty / parseFloat(bom.standard_batch_size || 200)),
      procurementRequirements: procRequirements,
    };
  },

  /**
   * Raise a procurement requirement for raw material shortages
   */
  async raiseProcurementRequirement(requirementId, data, user) {
    const requirement = await fulfilmentRepository.findProductionRequirementById(requirementId);
    if (!requirement) {
      throw ApiError.notFound('Production requirement not found');
    }

    const { material_item_id, shortage_qty, uom_id, suggested_supplier_id, notes, create_purchase_order } = data;

    const item = await itemsRepository.findById(material_item_id);
    if (!item) {
      throw ApiError.notFound(`Material item '${material_item_id}' not found`);
    }

    const estimatedRate = parseFloat(item.standard_purchase_rate || 0);
    const estimatedTotal = Math.round(Number(shortage_qty) * estimatedRate * 100) / 100;

    let purchaseId = null;

    if (create_purchase_order && suggested_supplier_id && [ROLES.FACTORY_ADMIN, ROLES.OWNER].includes(user.role)) {
      const todayStr = new Date().toISOString().split('T')[0];
      const purchaseData = {
        supplierId: suggested_supplier_id,
        billDate: todayStr,
        items: [
          {
            item_id: material_item_id,
            quantity: Number(shortage_qty),
            uom_id: uom_id || item.base_uom_id,
            unit_rate: estimatedRate,
          },
        ],
        notes: `Procurement for Production Requirement #${requirement.requirement_number} (SO #${requirement.sales_order_number})`,
      };

      const purchaseRes = await purchasesService.createPurchase(purchaseData, user.id);
      purchaseId = purchaseRes.id;
    }

    const procReq = await fulfilmentRepository.createProcurementRequirement({
      production_requirement_id: requirementId,
      sales_order_id: requirement.sales_order_id,
      material_item_id,
      shortage_qty: Number(shortage_qty),
      uom_id: uom_id || item.base_uom_id,
      estimated_rate: estimatedRate,
      estimated_total: estimatedTotal,
      suggested_supplier_id: suggested_supplier_id || null,
      purchase_id: purchaseId,
      created_by: user.id,
      notes,
    });

    await fulfilmentRepository.createNotification({
      recipient_role: ROLES.FACTORY_ADMIN,
      title: `Material Shortage Request: ${procReq.requirement_number}`,
      message: `Requested ${shortage_qty} ${item.base_uom_id} of ${item.name} for Production Requirement #${requirement.requirement_number}.`,
      entity_type: 'procurement_requirement',
      entity_id: procReq.id,
      action_url: `/purchases`,
    });

    return procReq;
  },

  /**
   * Initiate a production run for a production requirement
   */
  async initiateProductionRun(requirementId, data, user) {
    const requirement = await fulfilmentRepository.findProductionRequirementById(requirementId);
    if (!requirement) {
      throw ApiError.notFound('Production requirement not found');
    }

    if (requirement.status === PRODUCTION_REQUIREMENT_STATUS.FULFILLED) {
      throw ApiError.badRequest('This production requirement is already fulfilled');
    }

    const bomHeader = await bomsRepository.findActiveByProductId(requirement.product_id);
    if (!bomHeader) {
      throw ApiError.badRequest('No active BOM exists for this product');
    }
    const bom = await bomsRepository.findById(bomHeader.id);

    const stdBatch = parseFloat(bom.standard_batch_size || 200);
    const plannedBatches = data.planned_batch_count || Math.max(0.5, Math.ceil(parseFloat(requirement.production_qty_required) / stdBatch));
    const runDate = data.run_date || new Date().toISOString().split('T')[0];

    const runData = {
      bom_id: bom.id,
      planned_batch_count: Number(plannedBatches),
      run_date: runDate,
      notes: `Initiated from Production Requirement #${requirement.requirement_number} (SO #${requirement.sales_order_number})`,
    };

    const run = await productionService.createProductionRun(runData, user.id);

    await fulfilmentRepository.updateRequirementStatus(
      requirementId,
      PRODUCTION_REQUIREMENT_STATUS.IN_PRODUCTION,
      { production_run_id: run.id }
    );

    return {
      requirementId,
      productionRun: run,
      message: `Production run ${run.run_number} scheduled. Status: DRAFT`,
    };
  },

  /**
   * Handle production yield completion
   */
  async handleProductionYield(finishedGoodItemId, goodOutputQty, runId) {
    let targetRequirements = [];
    if (runId) {
      const linkedRes = await query(
        `SELECT pr.*, so.order_number 
         FROM production_requirements pr
         JOIN sales_orders so ON pr.sales_order_id = so.id
         WHERE pr.production_run_id = $1 AND pr.status IN ('pending', 'pending_production_review', 'scheduled', 'awaiting_materials', 'in_production', 'partially_fulfilled');`,
        [runId]
      );
      targetRequirements.push(...linkedRes.rows);
    }

    const otherRes = await query(
      `SELECT pr.*, so.order_number 
       FROM production_requirements pr
       JOIN sales_orders so ON pr.sales_order_id = so.id
       WHERE pr.product_id = $1 
         AND pr.status IN ('pending', 'pending_production_review', 'scheduled', 'awaiting_materials', 'in_production', 'partially_fulfilled')
         ${runId ? 'AND (pr.production_run_id IS NULL OR pr.production_run_id != $2)' : ''}
       ORDER BY pr.created_at ASC;`,
      runId ? [finishedGoodItemId, runId] : [finishedGoodItemId]
    );
    targetRequirements.push(...otherRes.rows);

    let remainingYieldToAllocate = Number(goodOutputQty);

    for (const req of targetRequirements) {
      if (remainingYieldToAllocate <= 0) break;

      const needed = Number(req.production_qty_required);
      const allocated = Math.min(needed, remainingYieldToAllocate);

      remainingYieldToAllocate -= allocated;

      if (allocated >= needed) {
        await fulfilmentRepository.updateRequirementStatus(
          req.id,
          PRODUCTION_REQUIREMENT_STATUS.FULFILLED,
          {
            fulfilled_qty: Number(req.fulfilled_qty || 0) + allocated,
            production_qty_required: 0,
            production_run_id: runId,
          }
        );

        await fulfilmentRepository.createNotification({
          recipient_role: ROLES.FACTORY_ADMIN,
          title: `Production Complete: SO #${req.order_number} Ready!`,
          message: `Finished goods yield completed. Order #${req.order_number} is now ready to dispatch.`,
          entity_type: 'order_fulfilment',
          entity_id: req.sales_order_id,
          action_url: `/sales/fulfilment`,
        });
      } else {
        await fulfilmentRepository.updateRequirementStatus(
          req.id,
          PRODUCTION_REQUIREMENT_STATUS.PARTIALLY_FULFILLED,
          {
            fulfilled_qty: Number(req.fulfilled_qty || 0) + allocated,
            production_qty_required: needed - allocated,
            production_run_id: runId,
          }
        );
      }

      await this.evaluateSalesOrder(req.sales_order_id);
    }
  },

  /**
   * CRITICAL DISPATCH OPERATION (FULL OR PARTIAL DISPATCH)
   */
  async dispatchFulfilmentOrder(salesOrderId, dispatchData, user) {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // 1. Lock Sales Order FOR UPDATE
      const soRes = await client.query(
        `SELECT so.*, p.trade_name AS customer_name, p.state_code AS customer_state_code 
         FROM sales_orders so 
         JOIN parties p ON so.customer_id = p.id
         WHERE so.id = $1 
         FOR UPDATE;`,
        [salesOrderId]
      );

      if (soRes.rows.length === 0) {
        throw ApiError.notFound('Sales order not found');
      }

      const order = soRes.rows[0];

      if (!['approved', 'invoiced', 'partially_dispatched'].includes(order.status)) {
        throw ApiError.badRequest(
          `Sales order ${order.order_number} is in status "${order.status}". Only approved or partially dispatched orders can be dispatched.`
        );
      }

      // 2. Fetch order items with line locks
      const soiRes = await client.query(
        `SELECT * FROM sales_order_items WHERE sales_order_id = $1 FOR UPDATE;`,
        [salesOrderId]
      );
      const orderItems = soiRes.rows;
      const orderItemMap = new Map(orderItems.map((i) => [i.item_id, i]));

      // 3. Check already dispatched quantities
      const dispSumRes = await client.query(
        `SELECT di.item_id, COALESCE(SUM(di.dispatched_qty), 0.0000) AS dispatched_qty
         FROM dispatches d
         JOIN invoices inv ON d.invoice_id = inv.id
         JOIN dispatch_items di ON di.dispatch_id = d.id
         WHERE inv.sales_order_id = $1 AND d.status IN ('dispatched', 'delivered')
         GROUP BY di.item_id;`,
        [salesOrderId]
      );
      const alreadyDispatchedMap = new Map(dispSumRes.rows.map((r) => [r.item_id, parseFloat(r.dispatched_qty)]));

      // 4. Validate items to dispatch
      const itemsToDispatch = [];
      const requestedItems = dispatchData.items || [];

      if (requestedItems.length === 0) {
        throw ApiError.badRequest('At least one item must be specified for dispatch.');
      }

      for (const reqItem of requestedItems) {
        const orderItem = orderItemMap.get(reqItem.item_id);
        if (!orderItem) {
          throw ApiError.badRequest(`Item '${reqItem.item_id}' does not belong to this sales order.`);
        }

        const approvedQty = parseFloat(orderItem.approved_qty !== null ? orderItem.approved_qty : orderItem.ordered_qty);
        const alreadyDispatched = alreadyDispatchedMap.get(reqItem.item_id) || 0.0000;
        const remainingQty = Math.max(0, approvedQty - alreadyDispatched);
        const requestedDispatchQty = parseFloat(reqItem.quantity || 0);

        if (requestedDispatchQty <= 0) {
          continue;
        }

        if (requestedDispatchQty > remainingQty) {
          throw ApiError.badRequest(
            `Dispatch quantity (${requestedDispatchQty}) exceeds remaining approved quantity (${remainingQty}) for '${orderItem.item_name_snapshot}'.`
          );
        }

        // Lock item & stock balance row
        await client.query(`SELECT 1 FROM items WHERE id = $1 FOR UPDATE;`, [reqItem.item_id]);
        const stockRes = await client.query(
          `SELECT current_base_qty, current_moving_wac FROM item_stock_balances WHERE item_id = $1 FOR UPDATE;`,
          [reqItem.item_id]
        );
        const currentStock = stockRes.rows.length > 0 ? parseFloat(stockRes.rows[0].current_base_qty) : 0;

        if (requestedDispatchQty > currentStock) {
          throw ApiError.badRequest(
            `Insufficient stock for '${orderItem.item_name_snapshot}'. Requested: ${requestedDispatchQty}, Available in warehouse: ${currentStock}.`
          );
        }

        // Resolve FEFO batch from live inventory
        const batchRes = await client.query(
          `SELECT batch_number 
           FROM v_batch_stock 
           WHERE item_id = $1 AND available_qty > 0 
           ORDER BY expiry_date ASC NULLS LAST 
           LIMIT 1;`,
          [reqItem.item_id]
        );

        const batchNumber = batchRes.rows[0]?.batch_number || `BATCH-${new Date().getFullYear()}-DISP`;

        itemsToDispatch.push({
          orderItem,
          dispatchedQty: requestedDispatchQty,
          batchNumber,
          unitPrice: parseFloat(orderItem.unit_price),
          gstRatePct: parseFloat(orderItem.gst_rate_pct || 0),
        });
      }

      if (itemsToDispatch.length === 0) {
        throw ApiError.badRequest('No valid item quantities to dispatch.');
      }

      // 5. Generate Invoice
      const dispatchDate = dispatchData.dispatchDate || new Date().toISOString().split('T')[0];
      const financialYear = getFinancialYear(dispatchDate);
      const invoiceNumber = await invoicesRepository.generateInvoiceNumber(dispatchDate, client);

      const isInterstate = order.customer_state_code !== '33';
      let invoiceTaxable = 0;
      let invoiceCgst = 0;
      let invoiceSgst = 0;
      let invoiceIgst = 0;

      const invoiceLineItems = itemsToDispatch.map((it) => {
        const taxable = Math.round(it.dispatchedQty * it.unitPrice * 100) / 100;
        let cgst = 0, sgst = 0, igst = 0;

        if (isInterstate) {
          igst = Math.round(taxable * (it.gstRatePct / 100) * 100) / 100;
        } else {
          cgst = Math.round(taxable * (it.gstRatePct / 200) * 100) / 100;
          sgst = Math.round(taxable * (it.gstRatePct / 200) * 100) / 100;
        }

        invoiceTaxable += taxable;
        invoiceCgst += cgst;
        invoiceSgst += sgst;
        invoiceIgst += igst;

        return {
          item_id: it.orderItem.item_id,
          item_name_snapshot: it.orderItem.item_name_snapshot,
          hsn_code_snapshot: it.orderItem.hsn_code_snapshot,
          batch_number: it.batchNumber,
          quantity: it.dispatchedQty,
          uom_id: it.orderItem.uom_id,
          base_quantity: it.dispatchedQty,
          unit_price: it.unitPrice,
          gst_rate_pct: it.gstRatePct,
          cgst_rate_pct: isInterstate ? 0 : it.gstRatePct / 2,
          cgst_amount: cgst,
          sgst_rate_pct: isInterstate ? 0 : it.gstRatePct / 2,
          sgst_amount: sgst,
          igst_rate_pct: isInterstate ? it.gstRatePct : 0,
          igst_amount: igst,
          taxable_value: taxable,
          total_item_value: taxable + cgst + sgst + igst,
        };
      });

      invoiceTaxable = Math.round(invoiceTaxable * 100) / 100;
      invoiceCgst = Math.round(invoiceCgst * 100) / 100;
      invoiceSgst = Math.round(invoiceSgst * 100) / 100;
      invoiceIgst = Math.round(invoiceIgst * 100) / 100;
      const totalInvoiceValue = Math.round((invoiceTaxable + invoiceCgst + invoiceSgst + invoiceIgst) * 100) / 100;

      const invoice = await invoicesRepository.createWithItems(
        {
          invoice_number: invoiceNumber,
          sales_order_id: salesOrderId,
          customer_id: order.customer_id,
          invoice_date: dispatchDate,
          place_of_supply_state_code: order.customer_state_code || '33',
          is_interstate: isInterstate,
          financial_year: financialYear,
          taxable_value: invoiceTaxable,
          cgst_amount: invoiceCgst,
          sgst_amount: invoiceSgst,
          igst_amount: invoiceIgst,
          total_invoice_value: totalInvoiceValue,
          status: 'posted',
          approved_by: user.id,
        },
        invoiceLineItems,
        client
      );

      // 6. Create Dispatch Note
      const dispatchNumber = await dispatchesRepository.generateDispatchNumber(dispatchDate, client);
      const dispatchItemsPayload = itemsToDispatch.map((it) => ({
        item_id: it.orderItem.item_id,
        batch_number: it.batchNumber,
        dispatched_qty: it.dispatchedQty,
        uom_id: it.orderItem.uom_id,
        base_quantity: it.dispatchedQty,
      }));

      const dispatch = await dispatchesRepository.createWithItems(
        {
          dispatch_number: dispatchNumber,
          invoice_id: invoice.id,
          dispatch_date: dispatchDate,
          carrier_or_vehicle_no: dispatchData.carrierOrVehicleNo || 'TN-45-AT-2026',
          driver_name: dispatchData.driverName || 'Verified Factory Logistics',
          status: 'ready',
          dispatched_by: user.id,
        },
        dispatchItemsPayload,
        client
      );

      // 7. Post sales dispatch atomically via database engine
      await client.query(`SELECT fn_post_sales_dispatch($1, $2);`, [dispatch.id, user.id]);

      // 8. Re-evaluate remaining requirements
      await this.evaluateSalesOrder(salesOrderId, client);

      await client.query('COMMIT');

      return {
        success: true,
        salesOrderId,
        dispatchNumber: dispatch.dispatch_number,
        invoiceNumber: invoice.invoice_number,
        totalDispatchedValue: totalInvoiceValue,
        itemsDispatched: itemsToDispatch.map((i) => ({
          name: i.orderItem.item_name_snapshot,
          quantity: i.dispatchedQty,
          uom: i.orderItem.uom_id,
        })),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async getNotifications(user, limit = 20) {
    return await fulfilmentRepository.findNotifications(user.role, user.id, limit);
  },

  async markNotificationRead(id) {
    return await fulfilmentRepository.markNotificationRead(id);
  },

  async markAllNotificationsRead(user) {
    await fulfilmentRepository.markAllNotificationsRead(user.role, user.id);
    return { success: true };
  },
};
