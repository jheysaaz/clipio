/**
 * Type definitions for the application
 */

export interface User {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Snippet {
  id: string;
  label: string;
  content: string;
  shortcut: string;
  tags?: string[];
  userId?: string;
  usageCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
}

export interface LoginResponse {
  accessToken: string;
  expiresIn?: number;
  user: User;
  refreshToken?: string;
}

export interface SnippetFormData {
  label: string;
  shortcut: string;
  content: string;
  tags?: string[];
  userId?: string;
}
