import ReactDOM from 'react-dom'
import './index.css'
import App from './App'
import { languageTag } from './i18n'

const root = document.getElementById('root')
document.documentElement.lang = languageTag() === 'zh' ? 'zh-CN' : 'en'

ReactDOM.render(<App />, root)
