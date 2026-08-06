/**
 * @eloquentjs/validator — Validator
 *
 * Extends @eloquentjs/core's Validator with:
 *   - Nested field validation (address.city, items.*.name — real expansion)
 *   - after() hooks and addError()
 *   - Rule object support (new UniqueRule(), new ExistsRule())
 *   - Conditional rules (sometimes, required_with, required_without_all)
 *   - More built-in rules: digits, ip, json, starts_with, ends_with, size,
 *     alpha, alpha_num, alpha_dash, timezone, uuid, mac_address, prohibited,
 *     required_with, required_without, required_without_all, required_with_all,
 *     bail (stop on first failure across ALL fields)
 *   - Full nested dot-notation: 'address.city', 'items.*.price'
 *   - Custom error messages with :field, :value, :param placeholders
 *   - Stops at first rule failure per field by default (bail)
 */

import { Validator as CoreValidator } from '@eloquentjs/core'
import { Rule } from './Rule.js'

/** Rule names that need a database round trip; only validateAsync() runs them. */
const ASYNC_RULE_NAMES = ['unique', 'exists']

export class Validator extends CoreValidator {
    constructor(data, rules, messages = {}, attributes = {}) {
        super(data, rules, messages, attributes)
        this._sometimes = new Set()   // fields that only validate when present
        this._bail = false       // stop all validation on first failure
        this._afterHooks = []
    }

    /**
     * Stop validating further fields after the first failure.
     */
    bail() {
        this._bail = true
        return this
    }

    /**
     * Mark fields that should only be validated when present in the input.
     * @param {...string} fields
     */
    sometimes(...fields) {
        for (const f of fields) this._sometimes.add(f)
        return this
    }

    /**
     * Register a callback run after the rules pass. Receives the validator, so
     * it can add errors: `v.after(v => { if (bad) v.addError('x', 'nope') })`
     */
    after(callback) {
        this._afterHooks.push(callback)
        return this
    }

    addError(field, message) {
        if (!this.errors[field]) this.errors[field] = []
        this.errors[field].push(message)
        this._passed = false
        return this
    }

    // ─── Sync validation ───────────────────────────────────────────────────────

    validate() {
        this.errors = {}

        for (const [field, ruleList] of Object.entries(this.rules)) {
            // 'sometimes' — skip if field not present in data
            if (this._sometimes.has(field) && !this._hasValue(field)) continue

            for (const [expanded, rules] of this._expandField(field, ruleList)) {
                const fieldErrors = this._validateField(expanded, rules)
                if (fieldErrors.length) {
                    this.errors[expanded] = fieldErrors
                    if (this._bail) break
                }
            }
            if (this._bail && Object.keys(this.errors).length) break
        }

        this._passed = Object.keys(this.errors).length === 0
        if (this._passed) this._runAfterHooks()
        return this._passed
    }

    _runAfterHooks() {
        for (const hook of this._afterHooks) hook(this)
        this._passed = Object.keys(this.errors).length === 0
        return this._passed
    }

    /**
     * Expand a wildcard path into the concrete paths present in the data:
     * 'items.*.price' → ['items.0.price', 'items.1.price'].
     * The header advertised this; _getValue used to walk a literal '*' key and
     * return undefined, so wildcard rules never ran.
     * @returns {[string, any[]][]}
     */
    _expandField(field, ruleList) {
        if (!field.includes('*')) return [[field, ruleList]]

        const at = field.indexOf('*')
        const prefix = field.slice(0, at).replace(/\.$/, '')
        const suffix = field.slice(at + 1).replace(/^\./, '')
        const container = prefix ? this._getValue(prefix) : this.data

        if (container == null || typeof container !== 'object') return []
        const keys = Array.isArray(container) ? container.map((_, i) => String(i)) : Object.keys(container)

        return keys.flatMap(key => {
            const path = [prefix, key, suffix].filter(Boolean).join('.')
            return this._expandField(path, ruleList)
        })
    }

    // ─── Async validation ─────────────────────────────────────────────────────

    /**
     * Run validation including async rules (unique, exists, custom async Rule objects).
     * @returns {Promise<boolean>}
     */
    async validateAsync() {
        this.errors = {}

        for (const [field, ruleList] of Object.entries(this.rules)) {
            if (this._sometimes.has(field) && !this._hasValue(field)) continue

            for (const [expanded, rules] of this._expandField(field, ruleList)) {
                const fieldErrors = await this._validateFieldAsync(expanded, rules)
                if (fieldErrors.length) {
                    this.errors[expanded] = fieldErrors
                    if (this._bail) break
                }
            }
            if (this._bail && Object.keys(this.errors).length) break
        }

        this._passed = Object.keys(this.errors).length === 0
        if (this._passed) this._runAfterHooks()
        return this._passed
    }

    // ─── Field error extraction ────────────────────────────────────────────────

    _validateField(field, ruleList) {
        const errors = []
        const value = this._getValue(field)

        // `nullable` short-circuits the whole field — see CoreValidator.
        if (this._isEmpty(value) && this._hasRule(ruleList, 'nullable') && !this._hasRule(ruleList, 'required')) {
            return errors
        }

        for (const rule of ruleList) {
            if (rule === 'bail') { /* local bail — stop this field on first error (default anyway) */ break }

            const [name] = CoreValidator.parseRule(rule)
            if (ASYNC_RULE_NAMES.includes(name)) continue   // validateAsync() handles these

            // Skip non-implicit rules when value is empty (unless required)
            if (this._isEmpty(value) && !this._isImplicit(rule) && !this._isRequiredRule(rule)) {
                continue
            }

            const error = this._checkExtended(field, value, rule)
            if (error) {
                errors.push(error)
                break // stop at first error per field
            }
        }

        return errors
    }

    async _validateFieldAsync(field, ruleList) {
        const errors = this._validateField(field, ruleList)
        if (errors.length) return errors

        const value = this._getValue(field)

        for (const rule of ruleList) {
            if (rule === 'bail') break

            if (this._isEmpty(value) && !this._isImplicit(rule) && !this._isRequiredRule(rule)) {
                continue
            }

            let error = null

            // Rule object with async support
            if (rule instanceof Rule) {
                const passed = await rule.passesAsync(field, value, this.data)
                if (!passed) error = rule.formatMessage(this._displayName(field), value)
            } else {
                const [name, param] = CoreValidator.parseRule(rule)
                if (!ASYNC_RULE_NAMES.includes(name)) continue
                error = await this._checkAsync(field, value, name, param)
            }

            if (error) {
                errors.push(error)
                break
            }
        }

        return errors
    }

    // ─── Extended rule checker (superset of core) ─────────────────────────────

    _checkExtended(field, value, rule) {
        // Rule object — sync path
        if (rule instanceof Rule) {
            const passed = rule.passes(field, value, this.data)
            if (!passed) return rule.formatMessage(this._displayName(field), value)
            return null
        }

        if (typeof rule === 'function') {
            return rule(field, value, this.data) ?? null
        }

        const [name, param] = CoreValidator.parseRule(String(rule))
        const displayField = this._displayName(field)

        switch (name) {
            // ── New rules not in core ──────────────────────────────────────────────

            case 'sometimes':
                return null // handled at field level

            case 'bail':
                return null

            case 'prohibited':
                if (value != null && value !== '') {
                    return this._msg(field, 'prohibited', `The ${displayField} field is prohibited.`)
                }
                break

            case 'required_with': {
                const fields = (param ?? '').split(',')
                const anyPresent = fields.some(f => this._hasValue(f.trim()))
                if (anyPresent && this._isEmpty(value)) {
                    return this._msg(field, 'required_with', `The ${displayField} field is required when ${fields.join(', ')} is present.`)
                }
                break
            }

            case 'required_with_all': {
                const fields = (param ?? '').split(',')
                const allPresent = fields.every(f => this._hasValue(f.trim()))
                if (allPresent && this._isEmpty(value)) {
                    return this._msg(field, 'required_with_all', `The ${displayField} field is required when all of ${fields.join(', ')} are present.`)
                }
                break
            }

            case 'required_without': {
                const fields = (param ?? '').split(',')
                const anyAbsent = fields.some(f => !this._hasValue(f.trim()))
                if (anyAbsent && this._isEmpty(value)) {
                    return this._msg(field, 'required_without', `The ${displayField} field is required when ${fields.join(', ')} is not present.`)
                }
                break
            }

            case 'required_without_all': {
                const fields = (param ?? '').split(',')
                const allAbsent = fields.every(f => !this._hasValue(f.trim()))
                if (allAbsent && this._isEmpty(value)) {
                    return this._msg(field, 'required_without_all', `The ${displayField} field is required when none of ${fields.join(', ')} are present.`)
                }
                break
            }

            case 'size': {
                const size = Number(param)
                if (value != null) {
                    const len = typeof value === 'string' || Array.isArray(value) ? value.length : Number(value)
                    if (len !== size) {
                        return this._msg(field, 'size', `The ${displayField} must be ${size}.`)
                    }
                }
                break
            }

            case 'digits': {
                const n = Number(param)
                if (value != null && !/^\d+$/.test(String(value))) {
                    return this._msg(field, 'digits', `The ${displayField} must be numeric.`)
                }
                if (value != null && String(value).length !== n) {
                    return this._msg(field, 'digits', `The ${displayField} must be ${n} digits.`)
                }
                break
            }

            case 'digits_between': {
                const [lo, hi] = (param ?? '').split(',').map(Number)
                if (value != null) {
                    const len = String(value).length
                    if (!/^\d+$/.test(String(value)) || len < lo || len > hi) {
                        return this._msg(field, 'digits_between', `The ${displayField} must be between ${lo} and ${hi} digits.`)
                    }
                }
                break
            }

            case 'alpha':
                if (value != null && !/^[a-zA-Z]+$/.test(String(value))) {
                    return this._msg(field, 'alpha', `The ${displayField} may only contain letters.`)
                }
                break

            case 'alpha_num':
                if (value != null && !/^[a-zA-Z0-9]+$/.test(String(value))) {
                    return this._msg(field, 'alpha_num', `The ${displayField} may only contain letters and numbers.`)
                }
                break

            case 'alpha_dash':
                if (value != null && !/^[a-zA-Z0-9_-]+$/.test(String(value))) {
                    return this._msg(field, 'alpha_dash', `The ${displayField} may only contain letters, numbers, dashes, and underscores.`)
                }
                break

            case 'starts_with': {
                const prefixes = (param ?? '').split(',')
                if (value != null && !prefixes.some(p => String(value).startsWith(p))) {
                    return this._msg(field, 'starts_with', `The ${displayField} must start with one of: ${prefixes.join(', ')}.`)
                }
                break
            }

            case 'ends_with': {
                const suffixes = (param ?? '').split(',')
                if (value != null && !suffixes.some(s => String(value).endsWith(s))) {
                    return this._msg(field, 'ends_with', `The ${displayField} must end with one of: ${suffixes.join(', ')}.`)
                }
                break
            }

            case 'doesnt_start_with': {
                const prefixes = (param ?? '').split(',')
                if (value != null && prefixes.some(p => String(value).startsWith(p))) {
                    return this._msg(field, 'doesnt_start_with', `The ${displayField} must not start with: ${prefixes.join(', ')}.`)
                }
                break
            }

            case 'doesnt_end_with': {
                const suffixes = (param ?? '').split(',')
                if (value != null && suffixes.some(s => String(value).endsWith(s))) {
                    return this._msg(field, 'doesnt_end_with', `The ${displayField} must not end with: ${suffixes.join(', ')}.`)
                }
                break
            }

            case 'ip': {
                const ipv6 = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/
                if (value != null && !isIPv4(value) && !ipv6.test(String(value))) {
                    return this._msg(field, 'ip', `The ${displayField} must be a valid IP address.`)
                }
                break
            }

            case 'ipv4':
                // The old regex accepted 999.999.999.999 — each octet has to be 0-255.
                if (value != null && !isIPv4(value)) {
                    return this._msg(field, 'ipv4', `The ${displayField} must be a valid IPv4 address.`)
                }
                break

            case 'ipv6':
                if (value != null && !/^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(String(value))) {
                    return this._msg(field, 'ipv6', `The ${displayField} must be a valid IPv6 address.`)
                }
                break

            case 'uuid':
                if (value != null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value))) {
                    return this._msg(field, 'uuid', `The ${displayField} must be a valid UUID.`)
                }
                break

            case 'json':
                if (value != null) {
                    try { JSON.parse(String(value)) } catch {
                        return this._msg(field, 'json', `The ${displayField} must be a valid JSON string.`)
                    }
                }
                break

            case 'mac_address':
                if (value != null && !/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(String(value))) {
                    return this._msg(field, 'mac_address', `The ${displayField} must be a valid MAC address.`)
                }
                break

            case 'timezone': {
                if (value != null) {
                    try { Intl.DateTimeFormat(undefined, { timeZone: String(value) }) }
                    catch { return this._msg(field, 'timezone', `The ${displayField} must be a valid timezone.`) }
                }
                break
            }

            // before/after accept a date literal OR another field name, as
            // Laravel's do ('before:end_date').
            case 'before': {
                const d = this._resolveDate(param)
                if (value != null && d && new Date(value) >= d) {
                    return this._msg(field, 'before', `The ${displayField} must be a date before ${param}.`)
                }
                break
            }

            case 'after': {
                const d = this._resolveDate(param)
                if (value != null && d && new Date(value) <= d) {
                    return this._msg(field, 'after', `The ${displayField} must be a date after ${param}.`)
                }
                break
            }

            case 'before_or_equal': {
                const d = this._resolveDate(param)
                if (value != null && d && new Date(value) > d) {
                    return this._msg(field, 'before_or_equal', `The ${displayField} must be a date before or equal to ${param}.`)
                }
                break
            }

            case 'after_or_equal': {
                const d = this._resolveDate(param)
                if (value != null && d && new Date(value) < d) {
                    return this._msg(field, 'after_or_equal', `The ${displayField} must be a date after or equal to ${param}.`)
                }
                break
            }

            case 'gt': {
                const other = this._getValue(param)
                if (value != null && other != null && Number(value) <= Number(other)) {
                    return this._msg(field, 'gt', `The ${displayField} must be greater than ${param}.`)
                }
                break
            }

            case 'gte': {
                const other = this._getValue(param)
                if (value != null && other != null && Number(value) < Number(other)) {
                    return this._msg(field, 'gte', `The ${displayField} must be greater than or equal to ${param}.`)
                }
                break
            }

            case 'lt': {
                const other = this._getValue(param)
                if (value != null && other != null && Number(value) >= Number(other)) {
                    return this._msg(field, 'lt', `The ${displayField} must be less than ${param}.`)
                }
                break
            }

            case 'lte': {
                const other = this._getValue(param)
                if (value != null && other != null && Number(value) > Number(other)) {
                    return this._msg(field, 'lte', `The ${displayField} must be less than or equal to ${param}.`)
                }
                break
            }

            default:
                // Delegate everything else — including 'required' and the core
                // rules — to the parent, so each rule name has exactly one
                // implementation. Core already formats via _displayName, so no
                // post-hoc field-name substitution is needed (the old
                // `new RegExp(field)` was both wrong for regex metacharacters in
                // field names and a latent ReDoS).
                return super._check(field, value, rule)
        }

        return null
    }

    /** A date literal, or the value of another field. */
    _resolveDate(param) {
        const other = this._getValue(param)
        const source = other !== undefined ? other : param
        const d = new Date(source)
        return isNaN(d.getTime()) ? null : d
    }

    // ─── Nested field support ─────────────────────────────────────────────────

    /**
     * Get a value by dot-notation path. Wildcards are expanded to concrete
     * paths by _expandField() before this is called.
     * 'address.city'  → data.address.city
     * 'items.0.name'  → data.items[0].name
     */
    _getValue(field) {
        if (typeof field !== 'string' || !field.includes('.')) return this.data?.[field]
        let current = this.data
        for (const part of field.split('.')) {
            if (current == null) return undefined
            current = current[part]
        }
        return current
    }

    _hasValue(field) {
        const v = this._getValue(field)
        return v !== undefined && v !== null && v !== ''
    }

    // ─── Helper: check if rule is "implicit" (runs on empty values) ───────────

    _isImplicit(rule) {
        if (rule instanceof Rule) return /** @type {typeof Rule} */ (rule.constructor).implicit === true
        if (typeof rule === 'string') {
            return ['required', 'required_if', 'required_with', 'required_with_all',
                'required_without', 'required_without_all', 'prohibited', 'sometimes'].includes(rule.split(':')[0])
        }
        return false
    }

    _isRequiredRule(rule) {
        if (typeof rule !== 'string') return false
        return rule.startsWith('required')
    }
}

/** Strict IPv4: four octets, each 0-255. */
function isIPv4(value) {
    const parts = String(value).split('.')
    return parts.length === 4 && parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

// ─── Convenience: validate() standalone function ──────────────────────────────

/**
 * One-shot sync validation. Throws ValidationException on failure.
 *
 * @param {object} data
 * @param {object} rules
 * @param {object} messages
 * @returns {object} validated data
 */
export function validate(data, rules, messages = {}) {
    return Validator.make(data, rules, messages).validated()
}

/**
 * One-shot async validation. Throws ValidationException on failure.
 *
 * @param {object} data
 * @param {object} rules
 * @param {object} messages
 * @returns {Promise<object>} validated data
 */
export async function validateAsync(data, rules, messages = {}) {
    return Validator.make(data, rules, messages).validatedAsync()
}
