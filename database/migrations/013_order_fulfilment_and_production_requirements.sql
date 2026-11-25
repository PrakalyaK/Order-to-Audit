-- ============================================================================
-- MIGRATION 013: ORDER FULFILMENT, PRODUCTION REQUIREMENTS & IN-APP NOTIFICATIONS
-- ============================================================================

-- 1. Ensure sales_orders supports 'partially_dispatched' status
ALTER TABLE sales_orders DROP CONSTRAINT IF EXISTS sales_orders_status_check;
ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_status_check
  CHECK (status IN ('submitted', 'approved', 'rejected', 'invoiced', 'partially_dispatched', 'dispatched', 'cancelled'));

-- 2. Production Requirements (auto-generated from Sales Order stock shortage)
CREATE TABLE IF NOT EXISTS production_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_number VARCHAR(50) NOT NULL,
  sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  required_qty NUMERIC(14, 4) NOT NULL CHECK (required_qty > 0),
  available_qty_at_creation NUMERIC(14, 4) NOT NULL DEFAULT 0.0000 CHECK (available_qty_at_creation >= 0),
  production_qty_required NUMERIC(14, 4) NOT NULL CHECK (production_qty_required >= 0),
  fulfilled_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000 CHECK (fulfilled_qty >= 0),
  status VARCHAR(40) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'pending_production_review', 'scheduled', 'awaiting_materials', 'in_production', 'partially_fulfilled', 'fulfilled', 'production_completed', 'cancelled')),
  production_run_id UUID REFERENCES production_runs(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prod_req_sales_order ON production_requirements(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_prod_req_product ON production_requirements(product_id);
CREATE INDEX IF NOT EXISTS idx_prod_req_status ON production_requirements(status);

-- Prevent duplicate active production requirements for the same Sales Order and Product
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_so_product_prq
  ON production_requirements(sales_order_id, product_id)
  WHERE status IN ('pending', 'pending_production_review', 'scheduled', 'awaiting_materials', 'in_production', 'partially_fulfilled');

-- 3. Procurement Requirements / Material Shortage Requests (linked to Production Requirements)
CREATE TABLE IF NOT EXISTS procurement_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_number VARCHAR(50) NOT NULL,
  production_requirement_id UUID NOT NULL REFERENCES production_requirements(id) ON DELETE CASCADE,
  sales_order_id UUID REFERENCES sales_orders(id) ON DELETE SET NULL,
  material_item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  shortage_qty NUMERIC(14, 4) NOT NULL CHECK (shortage_qty > 0),
  uom_id VARCHAR(10) NOT NULL REFERENCES units_of_measure(id),
  estimated_rate NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  estimated_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  suggested_supplier_id UUID REFERENCES parties(id) ON DELETE SET NULL,
  purchase_id UUID REFERENCES purchase_bills(id) ON DELETE SET NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ordered', 'received', 'cancelled')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proc_req_prod_req ON procurement_requirements(production_requirement_id);
CREATE INDEX IF NOT EXISTS idx_proc_req_material ON procurement_requirements(material_item_id);
CREATE INDEX IF NOT EXISTS idx_proc_req_status ON procurement_requirements(status);

-- 4. In-App Notifications for Role-based routing
CREATE TABLE IF NOT EXISTS in_app_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_role VARCHAR(50),
  recipient_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  entity_type VARCHAR(50),
  entity_id UUID,
  action_url VARCHAR(255),
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_recipient ON in_app_notifications(recipient_role, is_read);
CREATE INDEX IF NOT EXISTS idx_notif_user ON in_app_notifications(recipient_user_id, is_read);

-- 5. View for Real-time Sales Order Fulfilment Status
CREATE OR REPLACE VIEW v_sales_order_fulfilment AS
WITH item_dispatches AS (
  SELECT 
    inv.sales_order_id,
    di.item_id,
    COALESCE(SUM(di.dispatched_qty), 0.0000) AS total_dispatched_qty
  FROM dispatches d
  JOIN invoices inv ON d.invoice_id = inv.id
  JOIN dispatch_items di ON di.dispatch_id = d.id
  WHERE d.status IN ('dispatched', 'delivered')
  GROUP BY inv.sales_order_id, di.item_id
),
line_evaluations AS (
  SELECT 
    so.id AS sales_order_id,
    so.order_number,
    so.order_date,
    so.status AS order_status,
    so.customer_id,
    p.trade_name AS customer_name,
    p.state_code AS customer_state_code,
    p.state_name AS customer_state_name,
    soi.id AS sales_order_item_id,
    soi.item_id,
    soi.item_name_snapshot AS product_name,
    soi.hsn_code_snapshot,
    soi.uom_id,
    COALESCE(soi.approved_qty, soi.ordered_qty) AS ordered_qty,
    COALESCE(idisp.total_dispatched_qty, 0.0000) AS already_dispatched_qty,
    GREATEST(0.0000, COALESCE(soi.approved_qty, soi.ordered_qty) - COALESCE(idisp.total_dispatched_qty, 0.0000)) AS remaining_qty,
    COALESCE(isb.current_base_qty, 0.0000) AS available_stock_qty,
    GREATEST(0.0000, 
      GREATEST(0.0000, COALESCE(soi.approved_qty, soi.ordered_qty) - COALESCE(idisp.total_dispatched_qty, 0.0000))
      - COALESCE(isb.current_base_qty, 0.0000)
    ) AS shortage_qty,
    CASE 
      WHEN (COALESCE(soi.approved_qty, soi.ordered_qty) - COALESCE(idisp.total_dispatched_qty, 0.0000)) <= 0 THEN 'fulfilled'
      WHEN GREATEST(0.0000, COALESCE(soi.approved_qty, soi.ordered_qty) - COALESCE(idisp.total_dispatched_qty, 0.0000)) <= COALESCE(isb.current_base_qty, 0.0000) THEN 'ready_to_dispatch'
      WHEN COALESCE(isb.current_base_qty, 0.0000) > 0 THEN 'partially_available'
      ELSE 'stock_shortage'
    END AS line_fulfilment_status
  FROM sales_orders so
  JOIN parties p ON so.customer_id = p.id
  JOIN sales_order_items soi ON so.id = soi.sales_order_id
  LEFT JOIN item_dispatches idisp ON so.id = idisp.sales_order_id AND soi.item_id = idisp.item_id
  LEFT JOIN item_stock_balances isb ON soi.item_id = isb.item_id
  WHERE so.status IN ('approved', 'invoiced', 'partially_dispatched')
)
SELECT 
  sales_order_id,
  order_number,
  order_date,
  order_status,
  customer_id,
  customer_name,
  customer_state_code,
  customer_state_name,
  sales_order_item_id,
  item_id,
  product_name,
  hsn_code_snapshot,
  uom_id,
  ordered_qty,
  already_dispatched_qty,
  remaining_qty,
  available_stock_qty,
  shortage_qty,
  line_fulfilment_status,
  CASE
    WHEN remaining_qty <= 0 THEN 'fulfilled'
    WHEN shortage_qty = 0 THEN 'ready_to_dispatch'
    WHEN available_stock_qty > 0 THEN 'partially_available'
    ELSE 'stock_shortage'
  END AS fulfilment_category
FROM line_evaluations;

-- 6. Updated atomic dispatch function with partial dispatch support
CREATE OR REPLACE FUNCTION public.fn_post_sales_dispatch(p_dispatch_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_dispatch RECORD;
    v_item RECORD;
    v_stock RECORD;
    v_item_name VARCHAR(150);
    v_computed_base_qty NUMERIC(14, 4);
    v_cost_amount NUMERIC(12, 2);
    v_sales_order_id UUID;
    v_total_ordered NUMERIC(14, 4);
    v_total_dispatched NUMERIC(14, 4);
BEGIN
    SELECT * INTO v_dispatch 
    FROM dispatches 
    WHERE id = p_dispatch_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dispatch % not found.', p_dispatch_id;
    END IF;

    IF v_dispatch.status <> 'ready' THEN
        RAISE EXCEPTION 'Duplicate Posting Error: Dispatch % is already in status "%"',
            v_dispatch.dispatch_number, v_dispatch.status;
    END IF;

    FOR v_item IN 
        SELECT * FROM dispatch_items WHERE dispatch_id = p_dispatch_id
    LOOP
        SELECT name INTO v_item_name FROM items WHERE id = v_item.item_id;

        -- Enforce base UOM conversion inside database
        v_computed_base_qty := fn_compute_base_quantity(v_item.item_id, v_item.dispatched_qty, v_item.uom_id);

        IF v_item.base_quantity IS NOT NULL AND ROUND(v_item.base_quantity, 4) <> v_computed_base_qty THEN
            RAISE EXCEPTION 'UOM Conversion Error: Dispatch item % base quantity mismatch. Declared: %, Computed: %',
                v_item.id, v_item.base_quantity, v_computed_base_qty;
        END IF;

        UPDATE dispatch_items 
        SET base_quantity = v_computed_base_qty 
        WHERE id = v_item.id;

        -- CONCURRENCY SAFEGUARD:
        -- Lock parent item record first, then lock stock balance row
        PERFORM 1 FROM items WHERE id = v_item.item_id FOR UPDATE;

        SELECT * INTO v_stock 
        FROM item_stock_balances 
        WHERE item_id = v_item.item_id 
        FOR UPDATE;

        IF NOT FOUND OR v_stock.current_base_qty < v_computed_base_qty THEN
            RAISE EXCEPTION 'Negative Inventory Prevention: Insufficient finished stock for "%". Required: %, Available: %',
                v_item_name, v_computed_base_qty, COALESCE(v_stock.current_base_qty, 0);
        END IF;

        v_cost_amount := ROUND(v_computed_base_qty * v_stock.current_moving_wac, 2);

        -- Deduct from item_stock_balances (Moving WAC unit rate remains unchanged)
        UPDATE item_stock_balances 
        SET current_base_qty = current_base_qty - v_computed_base_qty,
            current_total_value = ROUND((current_base_qty - v_computed_base_qty) * current_moving_wac, 2),
            last_transaction_timestamp = NOW(),
            updated_at = NOW()
        WHERE item_id = v_item.item_id;

        -- Record sales dispatch in inventory ledger (Enforced by partial unique index uq_ledger_dispatch_item)
        INSERT INTO inventory_ledger (
            transaction_timestamp,
            item_id,
            batch_number,
            movement_type,
            transaction_qty,
            transaction_uom_id,
            base_quantity_delta,
            unit_cost,
            total_cost,
            dispatch_item_id,
            source_reference_label,
            created_by
        ) VALUES (
            NOW(),
            v_item.item_id,
            v_item.batch_number,
            'SALES_DISPATCH',
            v_item.dispatched_qty,
            v_item.uom_id,
            -v_computed_base_qty,
            v_stock.current_moving_wac,
            -v_cost_amount,
            v_item.id,
            v_dispatch.dispatch_number,
            p_user_id
        );
    END LOOP;

    -- Update statuses atomically across Dispatch and Invoice
    UPDATE dispatches SET status = 'dispatched' WHERE id = p_dispatch_id;
    UPDATE invoices SET status = 'dispatched' WHERE id = v_dispatch.invoice_id;

    -- Update Sales Order status: evaluate whether fully or partially dispatched
    SELECT sales_order_id INTO v_sales_order_id FROM invoices WHERE id = v_dispatch.invoice_id;

    IF v_sales_order_id IS NOT NULL THEN
        SELECT 
            COALESCE(SUM(COALESCE(soi.approved_qty, soi.ordered_qty)), 0),
            COALESCE((
                SELECT SUM(di.dispatched_qty)
                FROM dispatches d2
                JOIN invoices inv2 ON d2.invoice_id = inv2.id
                JOIN dispatch_items di ON di.dispatch_id = d2.id
                WHERE inv2.sales_order_id = v_sales_order_id
                  AND d2.status IN ('dispatched', 'delivered')
            ), 0)
        INTO v_total_ordered, v_total_dispatched
        FROM sales_order_items soi
        WHERE soi.sales_order_id = v_sales_order_id;

        IF v_total_dispatched >= v_total_ordered THEN
            UPDATE sales_orders SET status = 'dispatched' WHERE id = v_sales_order_id;
        ELSE
            UPDATE sales_orders SET status = 'partially_dispatched' WHERE id = v_sales_order_id;
        END IF;
    END IF;
END;
$function$;


-- 7. Allow transition to 'partially_dispatched' in sales order immutability trigger
CREATE OR REPLACE FUNCTION public.fn_prevent_invoiced_or_dispatched_so_modification()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('invoiced', 'partially_dispatched', 'dispatched') THEN
            RAISE EXCEPTION 'Integrity Violation: Cannot delete sales order % in status "%" as commercial or dispatch commitments exist.',
                OLD.order_number, OLD.status;
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'dispatched' AND NEW.status <> 'dispatched' THEN
            RAISE EXCEPTION 'Integrity Violation: Sales order % is dispatched and immutable. Status cannot be changed from "dispatched" to "%".',
                OLD.order_number, NEW.status;
        END IF;

        IF OLD.status IN ('invoiced', 'partially_dispatched') AND NEW.status NOT IN ('invoiced', 'partially_dispatched', 'dispatched', 'cancelled', 'approved') THEN
            RAISE EXCEPTION 'Integrity Violation: Cannot revert invoiced sales order % to status "%".',
                OLD.order_number, NEW.status;
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$function$;
