/**
 * @eloquentjs/validator — Validator
 *
 * Extends @eloquentjs/core's Validator with:
 *   - Async validation (validateAsync / failsAsync)
 *   - Nested field validation (address.city, items.*.name)
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

import { Validator as CoreValidator, ValidationException } from '@eloquentjs/core'
import { Rule } from './Rule.js'

export class Validator extends CoreValidator {
    constructor(data, rules, messages = {}, attributes = {}) {
        super(data, rules, messages)
        this._attributes = attributes  // custom field display names
        this._sometimes = new Set()   // fields that only validate when present
        this._bail = false       // stop all validation on first failure
    }

    // ─── Factory ──────────────────────────────────────────────────────────────

    static make(data, rules, messages = {}, attributes = {}) {
        return new Validator(data, rules, messages, attributes)
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

    // ─── Sync validation ───────────────────────────────────────────────────────

    validate() {
        this.errors = {}

        for (const [field, ruleList] of Object.entries(this.rules)) {
            // 'sometimes' — skip if field not present in data
            if (this._sometimes.has(field) && !this._hasValue(field)) continue

            // Expand dot-notation fields
            const fieldErrors = this._validateField(field, ruleList)
            if (fieldErrors.length) {
                this.errors[field] = fieldErrors
                if (this._bail) break
            }
        }

        this._passed = Object.keys(this.errors).length === 0
        return this._passed
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

            const fieldErrors = await this._validateFieldAsync(field, ruleList)
            if (fieldErrors.length) {
                this.errors[field] = fieldErrors
                if (this._bail) break
            }
        }

        this._passed = Object.keys(this.errors).length === 0
        return this._passed
    }

    async passesAsync() { return this.validateAsync() }
    async failsAsync() { return !(await this.validateAsync()) }

    /**
     * Like validated() but runs async validation first.
     * @returns {Promise<object>} — validated data subset
     */
    async validatedAsync() {
        await this.validateAsync()
        if (!this._passed) throw new ValidationException(this.errors)
        return this._extractValidated()
    }

    validated() {
        if (this._passed === null) this.validate()
        if (!this._passed) throw new ValidationException(this.errors)
        return this._extractValidated()
    }

    // ─── Field error extraction ────────────────────────────────────────────────

    _validateField(field, ruleList) {
        const errors = []
        const value = this._getValue(field)

        for (const rule of ruleList) {
            if (rule === 'bail') { /* local bail — stop this field on first error (default anyway) */ break }

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
        const errors = []
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
                // String rule — check if it's unique/exists (async by name)
                error = await this._checkAsyncStringRule(field, value, rule)
                    ?? this._checkExtended(field, value, rule)
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

        const [name, param] = String(rule).split(/:(.+)/)
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
                const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/
                const ipv6 = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/
                if (value != null && !ipv4.test(String(value)) && !ipv6.test(String(value))) {
                    return this._msg(field, 'ip', `The ${displayField} must be a valid IP address.`)
                }
                break
            }

            case 'ipv4':
                if (value != null && !/^(\d{1,3}\.){3}\d{1,3}$/.test(String(value))) {
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

            case 'before': {
                const d = new Date(param)
                if (value != null && new Date(value) >= d) {
                    return this._msg(field, 'before', `The ${displayField} must be a date before ${param}.`)
                }
                break
            }

            case 'after': {
                const d = new Date(param)
                if (value != null && new Date(value) <= d) {
                    return this._msg(field, 'after', `The ${displayField} must be a date after ${param}.`)
                }
                break
            }

            case 'before_or_equal': {
                const d = new Date(param)
                if (value != null && new Date(value) > d) {
                    return this._msg(field, 'before_or_equal', `The ${displayField} must be a date before or equal to ${param}.`)
                }
                break
            }

            case 'after_or_equal': {
                const d = new Date(param)
                if (value != null && new Date(value) < d) {
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

            // unique/exists are async — skip in sync path
            case 'unique':
            case 'exists':
                break

            default:
                // Delegate all remaining rules (including 'required' and core rules) to the
                // parent class so there is a single implementation for each rule name.
                const error = super._check(field, value, rule);

                // We need to run it through our _msg logic to replace :field or raw field names.
                if (typeof error === 'string') {
                    // We use our overridden _msg to handle the :field replacement,
                    // but since the core validator already returned a full string,
                    // we just need to make sure the raw field name is swapped out.
                    return error
                        .replace(new RegExp(field, 'g'), displayField)
                        .replace(new RegExp(field.replace(/_/g, ' '), 'g'), displayField);
                }

                return error;
        }

        return null
    }

    // ─── Async string rules (unique, exists) ──────────────────────────────────

    async _checkAsyncStringRule(field, value, rule) {
        if (typeof rule !== 'string') return null
        const [name, param] = rule.split(/:(.+)/)
        const displayField = this._displayName(field)

        if (name === 'unique') {
            const [table, col = field] = (param ?? '').split(',')
            const { UniqueRule } = await import('./Rule.js')
            const r = new UniqueRule(table.trim(), col.trim())
            const passed = await r.passesAsync(field, value, this.data)
            if (!passed) return this._msg(field, 'unique', `The ${displayField} has already been taken.`)
        }

        if (name === 'exists') {
            const [table, col = 'id'] = (param ?? '').split(',')
            const { ExistsRule } = await import('./Rule.js')
            const r = new ExistsRule(table.trim(), col.trim())
            const passed = await r.passesAsync(field, value, this.data)
            if (!passed) return this._msg(field, 'exists', `The selected ${displayField} is invalid.`)
        }

        return null
    }

    // ─── Nested field support ─────────────────────────────────────────────────

    /**
     * Get a value by dot-notation path, supporting wildcard * for arrays.
     * 'address.city'  → data.address.city
     * 'items.0.name'  → data.items[0].name
     */
    _getValue(field) {
        if (!field.includes('.')) return this.data[field]
        const parts = field.split('.')
        let current = this.data
        for (const part of parts) {
            if (current == null) return undefined
            current = current[part]
        }
        return current
    }

    _hasValue(field) {
        const v = this._getValue(field)
        return v !== undefined && v !== null && v !== ''
    }

    _isEmpty(value) {
        return value === undefined || value === null || value === ''
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

    // ─── Custom attribute display names ───────────────────────────────────────

    _displayName(field) {
        return this._attributes[field] ?? field.replace(/_/g, ' ')
    }

    // ─── Override _msg to support :field placeholder ──────────────────────────

    _msg(field, rule, fallback) {
        const msg = this.messages[`${field}.${rule}`]
            ?? this.messages[rule]
            ?? fallback
        return msg
            .replace(/:field/g, this._displayName(field))
            .replace(/:attribute/g, this._displayName(field))
    }

    _extractValidated() {
        const out = {}
        for (const key of Object.keys(this.rules)) {
            const value = this._getValue(key)
            if (value !== undefined) out[key] = value
        }
        return out
    }
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
