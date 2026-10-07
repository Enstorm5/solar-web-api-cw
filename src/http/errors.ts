// Central error catalogue and the single error representation (WSO2 guideline section 11).

export const ErrorCode = {
  INTERNAL: 1000,
  VALIDATION_FAILED: 1001,
  MALFORMED_JSON: 1002,
  INVALID_QUERY: 1003,
  INVALID_PATH_PARAMETER: 1004,
  AUTHENTICATION_REQUIRED: 1010,
  INVALID_TOKEN: 1011,
  INSUFFICIENT_SCOPE: 1020,
  PRECONDITION_REQUIRED: 1021,
  NOT_FOUND: 1030,
  ROUTE_NOT_FOUND: 1031,
  METHOD_NOT_ALLOWED: 1040,
  NOT_ACCEPTABLE: 1050,
  DUPLICATE_READING: 1060,
  INSTALLATION_HAS_READINGS: 1061,
  PRECONDITION_FAILED: 1070,
  PAYLOAD_TOO_LARGE: 1080,
  UNSUPPORTED_MEDIA_TYPE: 1090,
  SERVICE_UNAVAILABLE: 1100,
} as const;

const DESCRIPTIONS: Record<number, string> = {
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  405: 'Method not allowed',
  406: 'Not acceptable',
  409: 'Conflict',
  412: 'Precondition failed',
  413: 'Payload too large',
  415: 'Unsupported media type',
  500: 'Internal server error',
  503: 'Service unavailable',
};

export interface ErrorItem {
  code: number;
  message: string;
  field?: string;
}

export interface ErrorBody {
  code: number;
  message: string;
  description: string;
  error?: ErrorItem[];
  request_id: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number,
    message: string,
    readonly items?: ErrorItem[],
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }

  toBody(requestId: string): ErrorBody {
    return {
      code: this.code,
      message: this.message,
      description: DESCRIPTIONS[this.status] ?? 'Error',
      ...(this.items && this.items.length > 0 ? { error: this.items } : {}),
      request_id: requestId,
    };
  }
}

const BEARER_REALM = 'Bearer realm="solar"';

export const errors = {
  validation: (items: ErrorItem[], message = 'Request validation failed') =>
    new ApiError(400, ErrorCode.VALIDATION_FAILED, message, items),
  invalidQuery: (items: ErrorItem[]) =>
    new ApiError(400, ErrorCode.INVALID_QUERY, 'Invalid query parameters', items),
  invalidPath: (items: ErrorItem[]) =>
    new ApiError(400, ErrorCode.INVALID_PATH_PARAMETER, 'Invalid path parameter', items),
  malformedJson: () => new ApiError(400, ErrorCode.MALFORMED_JSON, 'Request body is not valid JSON'),
  authenticationRequired: () =>
    new ApiError(401, ErrorCode.AUTHENTICATION_REQUIRED, 'A bearer token is required', undefined, {
      'WWW-Authenticate': BEARER_REALM,
    }),
  invalidToken: (reason = 'The bearer token is invalid or expired') =>
    new ApiError(401, ErrorCode.INVALID_TOKEN, reason, undefined, {
      'WWW-Authenticate': `${BEARER_REALM}, error="invalid_token"`,
    }),
  insufficientScope: (required: string) =>
    new ApiError(403, ErrorCode.INSUFFICIENT_SCOPE, `This operation requires scope: ${required}`, undefined, {
      'WWW-Authenticate': `${BEARER_REALM}, error="insufficient_scope", scope="${required}"`,
    }),
  notFound: (what = 'Resource') => new ApiError(404, ErrorCode.NOT_FOUND, `${what} not found`),
  routeNotFound: () => new ApiError(404, ErrorCode.ROUTE_NOT_FOUND, 'No resource matches this URI'),
  methodNotAllowed: (allow: string[]) =>
    new ApiError(405, ErrorCode.METHOD_NOT_ALLOWED, 'Method not supported by this resource', undefined, {
      Allow: allow.join(', '),
    }),
  notAcceptable: () =>
    new ApiError(406, ErrorCode.NOT_ACCEPTABLE, 'Only application/json representations are available'),
  payloadTooLarge: () => new ApiError(413, ErrorCode.PAYLOAD_TOO_LARGE, 'Request body is too large'),
  unsupportedMediaType: () =>
    new ApiError(415, ErrorCode.UNSUPPORTED_MEDIA_TYPE, 'Request body must be application/json'),
  unavailable: () =>
    new ApiError(503, ErrorCode.SERVICE_UNAVAILABLE, 'Service temporarily unavailable'),
  internal: () => new ApiError(500, ErrorCode.INTERNAL, 'Unexpected server error'),
};
