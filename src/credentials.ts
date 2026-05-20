export function isCredentialError(error: unknown): boolean {
  const candidate = error as {
    name?: string;
    Code?: string;
    code?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const name = candidate.name ?? candidate.Code ?? candidate.code ?? "";
  const message = candidate.message ?? "";
  const status = candidate.$metadata?.httpStatusCode;

  return status === 401 ||
    name === "ExpiredToken" ||
    name === "ExpiredTokenException" ||
    name === "InvalidToken" ||
    name === "InvalidClientTokenId" ||
    name === "CredentialsProviderError" ||
    name === "TokenRefreshRequired" ||
    /session has expired|expired token|security token included in the request is expired/i.test(message);
}

export function credentialErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createCredentialRefreshError(error: unknown, retryCount: number): Error & { statusCode: number } {
  return Object.assign(
    new Error([
      `AWS credentials are expired and could not be refreshed inside this running process.`,
      `Retry count: ${retryCount}.`,
      `If you refreshed credentials with a shell export command, restart this S3 File Manager process.`,
      `Original error: ${credentialErrorMessage(error)}`,
    ].join(" ")),
    { statusCode: 401 },
  );
}
