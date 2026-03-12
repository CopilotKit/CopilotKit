import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Counter } from '../Counter'

describe('Counter', () => {
  it('renders the count value', () => {
    render(<Counter count={5} />)
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('renders zero count', () => {
    render(<Counter count={0} />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('renders the label', () => {
    render(<Counter count={3} />)
    expect(screen.getByText('Active Incidents')).toBeInTheDocument()
  })
})
