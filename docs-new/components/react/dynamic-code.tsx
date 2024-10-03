import { useEffect, useRef } from 'react'

export function DynamicCode({ children }) {
  const ref = useRef()
  const tokenRef = useRef()
  // Find the corresponding token from the DOM
  useEffect(() => {
    if (ref.current) {
      const token = [...ref.current.querySelectorAll('code span')].find(
        el => el.innerText === '1'
      )
      tokenRef.current = token
    }
  }, [])
  return (
    <>
      <div ref={ref} style={{ marginTop: '1.5rem' }}>
        {children}
      </div>
      <a
        onClick={() => {
          tokenRef.current.innerText =
            (parseInt(tokenRef.current.innerText) || 0) + 1
        }}
        style={{
          cursor: 'pointer',
          userSelect: 'none'
        }}
      >
        Increase the number
      </a>
      <a
        onClick={() => {
          tokenRef.current.innerText = '1 + 1'
        }}
        style={{
          marginLeft: '.5rem',
          cursor: 'pointer',
          userSelect: 'none'
        }}
      >
        Change to `1 + 1`
      </a>
    </>
  )
}