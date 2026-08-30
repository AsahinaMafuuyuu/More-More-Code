export class LocalSessionStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LocalSessionStoreError";
  }
}

export class LocalSessionConflictError extends LocalSessionStoreError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LocalSessionConflictError";
  }
}

export class LocalSessionNotFoundError extends LocalSessionStoreError {
  constructor(sessionId: string) {
    super(`Local Session ${sessionId} does not exist`);
    this.name = "LocalSessionNotFoundError";
  }
}

export class LocalSessionArchivedError extends LocalSessionStoreError {
  constructor(sessionId: string) {
    super(`Local Session ${sessionId} is archived and cannot be changed`);
    this.name = "LocalSessionArchivedError";
  }
}
