const https = require('https')
const fetch = require('node-fetch')
const puppeteer = require('puppeteer')

// 学籍番号
const studentNumber = process.env.STUDENT_NUMBER
// パスワード
const studentPassword = process.env.STUDENT_PASSWORD
// マトリクスコード (行ごとにコンマで区切ったXXXXXXXXXX,XXXXXXXXXX,XXXXXXXXXX,XXXXXXXXXX,XXXXXXXXXX,XXXXXXXXXX,XXXXXXXXXXの形式)
const matrixCode = process.env.MATRIX_CODE.split(',')

;(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-setuid-sandbox',
      '--no-first-run',
      '--no-sandbox',
      '--no-zygote',
      '--single-process',
    ],
  })
  const page = await browser.newPage()

  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
      req.abort()
    } else {
      req.continue()
    }
  })

  await page.goto('https://t2schola.titech.ac.jp')
  if (page.url().startsWith('https://portal.nap.gsic.titech.ac.jp')) {
    await Promise.all([
      page.waitForNavigation(),
      page.click('#portal-form > form:nth-child(2) > input[type=button]'),
    ])

    // studentNumberとstudentPasswordを入力
    await page.type(
      'body > center:nth-child(5) > form > table > tbody > tr > td > table > tbody > tr:nth-child(2) > td > div > div > input',
      studentNumber
    )
    await page.type(
      'body > center:nth-child(5) > form > table > tbody > tr > td > table > tbody > tr:nth-child(3) > td > div > div > input',
      studentPassword
    )
    await Promise.all([
      page.waitForNavigation(),
      page.click(
        'body > center:nth-child(5) > form > table > tbody > tr > td > table > tbody > tr:nth-child(5) > td > input[type=submit]:nth-child(1)'
      ),
    ])

    // マトリクスコードを入力
    for (let i = 5; i < 8; i++) {
      const text = await page.$eval(
        `#authentication > tbody > tr:nth-child(${i}) > th:nth-child(1)`,
        (el) => el.innerText
      )

      const [_, col, row] = text.match(/\[([A-J]),([1-7])\]/)
      const code = matrixCode[row.charCodeAt(0) - 49][col.charCodeAt(0) - 65]

      await page.type(
        `#authentication > tbody > tr:nth-child(${i}) > td > div > div > input`,
        code
      )
    }
    await Promise.all([
      page.waitForNavigation(),
      page.click(
        '#authentication > tbody > tr:nth-child(9) > td > input[type=submit]:nth-child(1)'
      ),
    ])
  }

  const cookies = (await page.cookies()).map((c) => `${c.name}=${c.value}`)

  await browser.close()
  console.log('browser closed')

  const opts = {
    protocol: 'https:',
    host: 't2schola.titech.ac.jp',
    path: '/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=1',
    method: 'GET',
    headers: {
      // accept:
      //   'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
      cookie: cookies,
    },
  }

  const req = https.request(opts, async (res) => {
    const tokenEncoded = res.headers.location?.match(
      /(?<=moodlemobile\:\/\/token\=).+/
    )[0]
    const token = Buffer.from(tokenEncoded, 'base64')
      .toString()
      .match(/(?<=\:{3}).+/)[0]

    const res2 = await fetch(
      `https://t2schola.titech.ac.jp/webservice/rest/server.php?wstoken=${token}&moodlewsrestformat=json&wsfunction=core_calendar_get_calendar_upcoming_view`
    )
    const json = await res2.json()
    const assignments = json.events

    console.log(
      assignments
        .map((a) => {
          const courseName = a.course.fullname.replace(/\s\/\s.+/g, '')
          const assignmentName =
            a.name.match(/「(.+)」の提出期限が近づいています/)[1]
          const dueDate = new Date(a.timestart * 1000).toLocaleString('ja-JP')
          return `${courseName}: ${assignmentName} (${dueDate})`
        })
        .join('\n')
    )
  })

  req.end()
})()
