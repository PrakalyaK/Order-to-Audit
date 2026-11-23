import { usersRepository } from './users.repository.js';
import { ApiError } from '../../utils/ApiError.js';

export const usersService = {
  async getAllUsers() {
    return usersRepository.findAll();
  },

  async getUserById(id) {
    const user = await usersRepository.findById(id);
    if (!user) {
      throw ApiError.notFound('User not found');
    }
    return user;
  },
};
