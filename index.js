const {URL, format} = require('url')
const puppeteer = require('puppeteer')
const mongoose = require('mongoose')

const talkSelector = '.talk-link a[href^="/talks"]'

const tedSchema = new mongoose.Schema({
  title: String,
  author: String,
  keywords: [String],
  url: String
})

const Ted = mongoose.model('Ted', tedSchema)

function makeTed(obj) {
  const query = {url: obj.url}
  const opts = {upsert: true, setDefaultsOnInsert: true}

  Ted.findOneAndUpdate(query, obj, opts, e => {
    if (e) throw e
  })
}

async function processTalk(page, talk) {
  // console.log('processing...', talk)
  await page.goto(talk)

  await page.$$eval('button', x => {
    const share = x.find(q => /share/i.test(q.innerText))
    if (!share) throw new Error('no share button')

    share.click()
  })

  const url = await page.$$eval('a', x => {
    const audio = x.find(q => /download audio/i.test(q.innerText))
    if (audio) return audio.href

    const video = x.find(q => /download video/i.test(q.innerText))
    if (video) return video.href
  })
  if (!url) throw new Error('no media url')

  const meta = await page.$$eval('meta', x => {
    return {
      keywords: ((x.find(q => q.name === 'keywords') || {}).content || '').split(', '),
      author:   (x.find(q => q.name === 'author') || {}).content,
      title:    (x.find(q => q.getAttribute('property') === 'og:title') || {}).content
    }
  })

  await makeTed({
    ...meta, 
    url: format(new URL(url), {search: false})          
  })
}

async function processPage(page, i) {
  console.log('page', i)
  await page.goto('https://ted.com/talks?page=' + i)
  
  const talks = await page.$$eval(talkSelector, x => x.map(q => q.href))
  if (!talks.length) return 0

  for (const t of talks) {
    try {
      await processTalk(page, t)
    }
    catch(e) {
      console.error(`(ERROR) [${t}]: ${e}`)
    }
  }

  return talks.length
}

async function run() {
  const browser = await puppeteer.launch()
  const page = await browser.newPage()
  let i = 1

  while (await processPage(page, i++)) {}

  return browser.close()
}

async function main() {
  try {
    await mongoose.connect('mongodb://localhost/ted')
    await run()
  }
  finally {
    await mongoose.disconnect()
  }
}

process.on('unhandledRejection', e => { throw e })
main()