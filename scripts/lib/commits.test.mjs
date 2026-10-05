import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { subjectOf, validateCommitMessage } from './commits.mjs'

const accepts = (message) => assert.equal(validateCommitMessage(message).ok, true, message)
const rejects = (message) => assert.equal(validateCommitMessage(message).ok, false, message)

describe('validateCommitMessage', () => {
  it('accepts a typed subject', () => {
    accepts('feat: add agent detail page')
    accepts('fix(api): reject undeclared config paths')
    accepts('refactor(catalog)!: drop the legacy manifest field')
    accepts('chore(deps): bump vite to 8.3')
  })

  it('rejects subjects without a type', () => {
    rejects('add agent detail page')
    rejects('feat add agent detail page')
  })

  it('rejects unknown types and malformed scopes', () => {
    rejects('feature: add agent detail page')
    rejects('fix(API): reject undeclared config paths')
  })

  it('rejects empty, overlong, and period-terminated subjects', () => {
    rejects('')
    rejects(`feat: ${'x'.repeat(120)}`)
    rejects('fix: something.')
  })

  it('ignores comment lines and accepts bot commits', () => {
    accepts('# comment only line\nfeat: real subject')
    accepts('Merge branch "main" into feature')
    accepts('Revert "feat: add agent detail page"')
    accepts('fixup! feat: add agent detail page')
    accepts('Bump vite from 8.3.1 to 8.3.2')
  })

  it('reads the first non-comment line', () => {
    assert.equal(subjectOf('\n# a comment\nchore: real\n\nbody'), 'chore: real')
  })
})
