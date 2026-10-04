import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from './config.js'

export const hashPassword = async (password) => bcrypt.hash(password, 10)

export const comparePassword = async (password, hash) => bcrypt.compare(password, hash)

export const signToken = (payload, options = {}) => jwt.sign(payload, JWT_SECRET, { expiresIn: '7d', ...options })

export const verifyToken = (token) => jwt.verify(token, JWT_SECRET)
