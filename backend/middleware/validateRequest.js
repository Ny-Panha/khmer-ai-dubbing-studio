/**
 * Standardized Request Validation & Response Envelope Helpers
 * Ensures consistent { success, data, error } envelopes and defensive payload checks
 * before invoking dubbingPipeline, ffmpegService, or ttsService.
 */

function sendSuccess(res, data = {}, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    data,
    ...(typeof data === "object" && data !== null && !Array.isArray(data) ? data : {}),
  });
}

function sendError(res, errorMessage = "Invalid Request", statusCode = 400, extra = {}) {
  return res.status(statusCode).json({
    success: false,
    error: String(errorMessage),
    ...extra,
  });
}

/**
 * Middleware factory to validate required fields on req.body
 * @param {string[]} requiredFields
 */
function requireBodyFields(requiredFields = []) {
  return (req, res, next) => {
    if (!req.body || typeof req.body !== "object") {
      return sendError(res, "Request body must be a valid JSON object", 400);
    }
    for (const field of requiredFields) {
      const val = req.body[field];
      if (val === undefined || val === null || (typeof val === "string" && val.trim() === "")) {
        return sendError(res, `Missing required field: ${field}`, 400);
      }
    }
    return next();
  };
}

/**
 * Middleware to guard against malformed JSON objects or non-object bodies on POST/PUT/PATCH
 */
function validateJsonBodyEnvelope(req, res, next) {
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    const contentType = String(req.headers?.["content-type"] || "").toLowerCase();
    if (contentType.includes("application/json") && (req.body === null || typeof req.body !== "object")) {
      return sendError(res, "Malformed JSON request payload", 400);
    }
  }
  return next();
}

module.exports = {
  sendSuccess,
  sendError,
  requireBodyFields,
  validateJsonBodyEnvelope,
};

