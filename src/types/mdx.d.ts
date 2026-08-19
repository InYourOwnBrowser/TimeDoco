declare module '*.mdx' {
  import React from 'react'
  export const meta: {
    title?: string
    date?: string
    tags?: string[]
    [key: string]: any
  }
  const Component: React.ComponentType
  export default Component
}
