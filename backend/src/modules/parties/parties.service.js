import { partiesRepository } from './parties.repository.js';
import { ApiError } from '../../utils/ApiError.js';

export const partiesService = {
  /**
   * Get paginated parties with search & filters
   */
  async getParties(queryParams) {
    return await partiesRepository.findAll(queryParams);
  },

  /**
   * Get single party details by ID
   */
  async getPartyById(id) {
    const party = await partiesRepository.findById(id);
    if (!party) {
      throw ApiError.notFound(`Party with ID '${id}' not found`);
    }
    return party;
  },

  /**
   * Create new party
   */
  async createParty(partyData) {
    // 1. Check duplicate GSTIN if provided
    if (partyData.gstin) {
      const existingGstin = await partiesRepository.findByGstin(partyData.gstin);
      if (existingGstin) {
        throw ApiError.conflict(
          `A party with GSTIN '${partyData.gstin}' already exists (${existingGstin.trade_name})`
        );
      }
    }

    // 2. Cross-validate state code matches first 2 digits of GSTIN if present
    if (partyData.gstin && partyData.gstin.length === 15) {
      const prefix = partyData.gstin.substring(0, 2);
      if (prefix !== partyData.state_code) {
        throw ApiError.badRequest(
          `GSTIN state code prefix '${prefix}' must match state_code '${partyData.state_code}'`
        );
      }
    }

    return await partiesRepository.create(partyData);
  },

  /**
   * Update party details
   */
  async updateParty(id, updateData) {
    const existing = await partiesRepository.findById(id);
    if (!existing) {
      throw ApiError.notFound(`Party with ID '${id}' not found`);
    }

    // If updating GSTIN, check conflict
    if (updateData.gstin && updateData.gstin.toUpperCase() !== (existing.gstin || '').toUpperCase()) {
      const duplicate = await partiesRepository.findByGstin(updateData.gstin);
      if (duplicate && duplicate.id !== id) {
        throw ApiError.conflict(
          `A party with GSTIN '${updateData.gstin}' already exists (${duplicate.trade_name})`
        );
      }
    }

    // Cross-validate GSTIN and state_code
    const effectiveGstin = updateData.gstin !== undefined ? updateData.gstin : existing.gstin;
    const effectiveState = updateData.state_code !== undefined ? updateData.state_code : existing.state_code;
    if (effectiveGstin && effectiveGstin.length === 15 && effectiveState) {
      if (effectiveGstin.substring(0, 2) !== effectiveState) {
        throw ApiError.badRequest(
          `GSTIN state code prefix '${effectiveGstin.substring(0, 2)}' must match state_code '${effectiveState}'`
        );
      }
    }

    return await partiesRepository.update(id, updateData);
  },

  /**
   * Set party active/inactive status
   */
  async setPartyStatus(id, isActive) {
    const existing = await partiesRepository.findById(id);
    if (!existing) {
      throw ApiError.notFound(`Party with ID '${id}' not found`);
    }

    return await partiesRepository.setStatus(id, isActive);
  },
};
