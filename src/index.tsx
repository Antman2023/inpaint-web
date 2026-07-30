import ReactDOM from 'react-dom'
import './index.css'
import App from './App'
import { loadingOnnxruntime } from './adapters/util'

async function bootstrap() {
  await loadingOnnxruntime()
  ReactDOM.render(<App />, document.getElementById('root'))
}

void bootstrap()
