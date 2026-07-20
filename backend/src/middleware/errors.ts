import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";

type RequestBodyError = Error & {
  status?: number;
  statusCode?: number;
  type?: string;
};

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export type RouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => unknown | Promise<unknown>;

export function asyncRoute(handler: RouteHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export const apiNotFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ message: `API endpoint ${req.method} ${req.path} was not found.` });
};

function getBodyParserErrorMessage(error: RequestBodyError) {
  if (error.type === "entity.parse.failed") {
    return { message: "Invalid JSON request body.", status: 400 };
  }

  if (error.type === "entity.too.large" || error.status === 413) {
    return { message: "Request body is too large.", status: 413 };
  }

  return null;
}

export const apiErrorHandler: ErrorRequestHandler = (
  error,
  req,
  res,
  next,
) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const bodyParserError = getBodyParserErrorMessage(error as RequestBodyError);

  if (bodyParserError) {
    res.status(bodyParserError.status).json({ message: bodyParserError.message });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ message: error.message });
    return;
  }

  const errorDetails = error instanceof Error ? error.stack || error.message : error;
  console.error("Unhandled API error", {
    error: errorDetails,
    method: req.method,
    path: req.originalUrl,
  });
  res.status(500).json({ message: "Internal server error." });
};
