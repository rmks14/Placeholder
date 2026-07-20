import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import {
  apiErrorHandler,
  apiNotFoundHandler,
  asyncRoute,
  HttpError,
} from "./errors";

function createResponse() {
  let statusCode = 200;
  let body: unknown;
  const response = {
    headersSent: false,
    json(value: unknown) {
      body = value;
      return response;
    },
    status(value: number) {
      statusCode = value;
      return response;
    },
  };

  return {
    response: response as unknown as Response,
    snapshot: () => ({ body, statusCode }),
  };
}

test("asyncRoute forwards rejected promises to Express", async () => {
  const expectedError = new Error("metrics failed");
  const handler = asyncRoute(async () => {
    throw expectedError;
  });

  const forwardedError = await new Promise<unknown>((resolve) => {
    handler({} as Request, {} as Response, resolve as NextFunction);
  });

  assert.equal(forwardedError, expectedError);
});

test("API errors return safe JSON responses", () => {
  const request = {
    method: "POST",
    originalUrl: "/api/metrics",
    path: "/metrics",
  } as Request;
  const next: NextFunction = (error) => {
    throw error;
  };

  const malformedJson = createResponse();
  apiErrorHandler(
    Object.assign(new SyntaxError("Unexpected token"), {
      type: "entity.parse.failed",
    }),
    request,
    malformedJson.response,
    next,
  );
  assert.deepEqual(malformedJson.snapshot(), {
    body: { message: "Invalid JSON request body." },
    statusCode: 400,
  });

  const oversizedBody = createResponse();
  apiErrorHandler(
    Object.assign(new Error("too large"), { status: 413, type: "entity.too.large" }),
    request,
    oversizedBody.response,
    next,
  );
  assert.deepEqual(oversizedBody.snapshot(), {
    body: { message: "Request body is too large." },
    statusCode: 413,
  });

  const safeClientError = createResponse();
  apiErrorHandler(
    new HttpError(409, "A safe conflict message."),
    request,
    safeClientError.response,
    next,
  );
  assert.deepEqual(safeClientError.snapshot(), {
    body: { message: "A safe conflict message." },
    statusCode: 409,
  });
});

test("unexpected API errors do not expose implementation details", () => {
  const originalConsoleError = console.error;
  console.error = () => undefined;

  try {
    const response = createResponse();
    apiErrorHandler(
      new Error("database password: should not be returned"),
      {
        method: "GET",
        originalUrl: "/api/metrics",
        path: "/metrics",
      } as Request,
      response.response,
      ((error?: unknown) => {
        throw error;
      }) as NextFunction,
    );

    assert.deepEqual(response.snapshot(), {
      body: { message: "Internal server error." },
      statusCode: 500,
    });
  } finally {
    console.error = originalConsoleError;
  }
});

test("unknown API paths return JSON 404 responses", () => {
  const response = createResponse();
  apiNotFoundHandler(
    { method: "GET", path: "/missing" } as Request,
    response.response,
    (() => undefined) as NextFunction,
  );

  assert.deepEqual(response.snapshot(), {
    body: { message: "API endpoint GET /missing was not found." },
    statusCode: 404,
  });
});
