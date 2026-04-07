/**
 * MCP Protocol — JSON-RPC 2.0 message types and framing
 *
 * The Model Context Protocol uses JSON-RPC 2.0 over stdio (or HTTP SSE).
 * This module handles message serialization with Content-Length framing,
 * compatible with Claude.ai, Cursor, Windsurf, and any MCP client.
 *
 * Wire format (stdio):
 *   Content-Length: <byte-length>\r\n
 *   \r\n
 *   <json-body>
 */

// ─── Message constructors ──────────────────────────────────────────────────────

export function makeResult(id, result) {
  return { jsonrpc: '2.0', id, result }
}

export function makeError(id, code, message, data = undefined) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined && { data }) } }
}

export function makeNotification(method, params = {}) {
  return { jsonrpc: '2.0', method, params }
}

// ─── Standard JSON-RPC error codes ────────────────────────────────────────────
export const ErrorCode = {
  ParseError:     -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams:  -32602,
  InternalError:  -32603,
  // MCP-specific
  NotInitialized:   -32002,
  ServerError:      -32000,
}

// ─── Content-Length framing ────────────────────────────────────────────────────

/**
 * Encode a JSON-RPC message with Content-Length header.
 * @param {object} msg
 * @returns {Buffer}
 */
export function encodeMessage(msg) {
  const body = JSON.stringify(msg)
  const bytes = Buffer.byteLength(body, 'utf8')
  return Buffer.from(`Content-Length: ${bytes}\r\n\r\n${body}`, 'utf8')
}

/**
 * Incremental parser for Content-Length framed messages.
 * Feed chunks of data; get complete messages back.
 */
export class MessageParser {
  constructor() {
    this._buf = Buffer.alloc(0)
  }

  /**
   * Feed a chunk of data. Returns an array of fully parsed message objects.
   * @param {Buffer|string} chunk
   * @returns {object[]}
   */
  push(chunk) {
    this._buf = Buffer.concat([this._buf, Buffer.from(chunk)])
    const messages = []
    while (true) {
      const msg = this._tryRead()
      if (!msg) break
      messages.push(msg)
    }
    return messages
  }

  _tryRead() {
    const str = this._buf.toString('utf8')
    const headerEnd = str.indexOf('\r\n\r\n')
    if (headerEnd === -1) return null

    const header = str.slice(0, headerEnd)
    const lenMatch = header.match(/Content-Length:\s*(\d+)/i)
    if (!lenMatch) {
      // Malformed — discard up to next header
      this._buf = this._buf.slice(headerEnd + 4)
      return null
    }

    const bodyLen    = parseInt(lenMatch[1], 10)
    const bodyStart  = Buffer.byteLength(str.slice(0, headerEnd + 4), 'utf8')
    const totalNeeded = bodyStart + bodyLen

    if (this._buf.length < totalNeeded) return null // incomplete

    const bodyBuf = this._buf.slice(bodyStart, bodyStart + bodyLen)
    this._buf = this._buf.slice(totalNeeded)

    try {
      return JSON.parse(bodyBuf.toString('utf8'))
    } catch {
      return null
    }
  }
}
