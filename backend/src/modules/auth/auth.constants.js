/**
 * Role Definitions matching database check constraint on users.role
 * Database allowed values: 'salesman', 'factory_admin', 'production_supervisor', 'auditor', 'owner'
 */
export const ROLES = {
  SALESMAN: 'salesman',
  FACTORY_ADMIN: 'factory_admin',
  PRODUCTION_SUPERVISOR: 'production_supervisor',
  AUDITOR: 'auditor',
  OWNER: 'owner',
};

export const ALL_ROLES = Object.values(ROLES);
