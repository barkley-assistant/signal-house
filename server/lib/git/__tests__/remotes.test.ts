import { describe, expect, it } from '@jest/globals'
import { parseGithubOriginRemote } from '../remotes'

describe('parseGithubOriginRemote', () => {
  it('parses SSH GitHub remotes', () => {
    expect(parseGithubOriginRemote('git@github.com:owner/repo.git')).toEqual({
      originRemoteUrl: 'git@github.com:owner/repo.git',
      githubOwner: 'owner',
      githubRepo: 'repo',
    })
  })

  it('parses HTTPS GitHub remotes', () => {
    expect(parseGithubOriginRemote('https://github.com/owner/repo.git')).toEqual({
      originRemoteUrl: 'https://github.com/owner/repo.git',
      githubOwner: 'owner',
      githubRepo: 'repo',
    })
  })

  it('accepts repo names without .git', () => {
    expect(parseGithubOriginRemote('https://github.com/owner/repo')).toEqual({
      originRemoteUrl: 'https://github.com/owner/repo',
      githubOwner: 'owner',
      githubRepo: 'repo',
    })
  })

  it('ignores non-GitHub remotes', () => {
    expect(parseGithubOriginRemote('git@bitbucket.org:owner/repo.git')).toBeNull()
    expect(parseGithubOriginRemote('https://example.com/owner/repo.git')).toBeNull()
  })

  it('ignores malformed remotes', () => {
    expect(parseGithubOriginRemote('not-a-remote')).toBeNull()
    expect(parseGithubOriginRemote('https://github.com/owner/repo/extra')).toBeNull()
  })

  it('returns null for empty or whitespace input', () => {
    expect(parseGithubOriginRemote('')).toBeNull()
    expect(parseGithubOriginRemote('   ')).toBeNull()
  })
})
