/**
 * Type definitions for the application
 * Aligned with snippy-backend v1.0 API models
 */

// User types (aligned with backend models.User)
export interface User {
  id: string; // UUID as string
  email: string;
  username: string;
  fullName: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

// Snippet types (aligned with backend models.Snippet)
export interface Snippet {
  id: number; // int64 from backend
  label: string;
  shortcut: string;
  content: string;
  tags: string[];
  userId?: string; // UUID as string
  createdAt: string;
  updatedAt: string;
  // Client-side only fields
  usageCount?: number;
}

// Auth types (aligned with backend models.LoginResponse)
export interface AuthTokens {
  accessToken: string;
  expiresIn: number;
}

export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: User;
}

// Form types
export interface SnippetFormData {
  label: string;
  shortcut: string;
  content: string;
  tags?: string[];
}

// Re-export API types for convenience
export type {
  ApiListResponse,
  ApiSyncResponse,
  ApiErrorResponse,
  ApiLoginResponse,
  ApiRefreshResponse,
  ApiAvailabilityResponse,
  ApiMessageResponse,
} from "./api";

export {
  isApiErrorResponse,
  isApiListResponse,
  isApiSyncResponse,
} from "./api";
