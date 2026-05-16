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
