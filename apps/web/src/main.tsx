import { render } from 'preact'
import './styles/global.css'
import { App } from './App'

const container = document.getElementById('app')
if (!container) throw new Error('missing #app root')
render(<App />, container)
