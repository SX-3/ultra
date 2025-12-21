export class UltraError extends Error {
  status: number;
  constructor(message: string, name: string, status: number) {
    super(message);
    this.name = name;
    this.status = status;
  }

  toResponse(): Response {
    return Response.json({
      error: {
        name: this.name,
        message: this.message,
      },
    }, {
      status: this.status,
    });
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
    };
  }
}

export class ValidationError extends UltraError {
  constructor(message = 'Validation failed') {
    super(message, 'ValidationError', 422);
  }
}

export class UnauthorizedError extends UltraError {
  constructor(message = 'Unauthorized') {
    super(message, 'UnauthorizedError', 401);
  }
}

export class NotFoundError extends UltraError {
  constructor(message = 'Not Found') {
    super(message, 'NotFoundError', 404);
  }
}

export class UnsupportedProtocolError extends UltraError {
  constructor(message = 'Unsupported Protocol') {
    super(message, 'UnsupportedProtocolError', 400);
  }
}
