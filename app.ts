import * as express from 'express'
import * as bodyParser from 'body-parser'

const app = express()

const port = process.env.PORT ? parseInt(process.env.PORT) : 3001

app.use(bodyParser.text({ type: '*/*' }))
app.use(express.static('public'))

app.get('/api/legado', require('./api/legado'))
app.post('/api/ra', require('./api/ra'))
app.get('/api/azure', require('./api/azure'))
app.post('/api/azure', require('./api/azure'))
app.get('/api/yx520', require('./api/yx520'))

app.listen(port, () => {
  console.info(`TTS应用正在监听 ${port} 端口`)
})
