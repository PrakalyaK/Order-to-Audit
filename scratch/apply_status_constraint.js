import { query } from '../backend/src/config/db.js';

async function main() {
  await query(`
    ALTER TABLE production_requirements DROP CONSTRAINT IF EXISTS production_requirements_status_check;
    ALTER TABLE production_requirements ADD CONSTRAINT production_requirements_status_check
      CHECK (status IN (
        'pending',
        'pending_production_review',
        'scheduled',
        'awaiting_materials',
        'in_production',
        'partially_fulfilled',
        'fulfilled',
        'production_completed',
        'cancelled'
      ));
  `);
  console.log('Successfully updated production_requirements_status_check constraint!');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
