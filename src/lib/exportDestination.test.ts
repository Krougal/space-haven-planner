import { describe, expect, it } from 'vitest'
import { dataURLToBlob } from './exportDestination'

describe('dataURLToBlob', () => {
  it('converts base64 data URLs to blobs', () => {
    const blob = dataURLToBlob('data:image/png;base64,AQID')

    expect(blob.type).toBe('image/png')
    expect(blob.size).toBe(3)
  })

  it('converts encoded text data URLs to blobs', () => {
    const blob = dataURLToBlob('data:text/plain,hello%20world')

    expect(blob.type).toBe('text/plain')
    expect(blob.size).toBe(11)
  })
})
