import { query } from '../backend/src/config/db.js';

async function main() {
  await query(`
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
  `);
  console.log('Successfully updated fn_prevent_invoiced_or_dispatched_so_modification()');
  process.exit(0);
}

main();
