/** Wire contracts only: no secrets, database entities or draw algorithms. */
export interface ApiResponse<T> { data: T; serverTime: string; traceId: string }
export interface ApiError {
  error: { code: string; message: string; retryable: boolean };
  serverTime: string;
  traceId: string;
}
export interface BootstrapStatus {
  service: 'starlit-api'; database: 'connected'; databaseTime: string;
  schemaVersion: string; installedAt: string;
}
