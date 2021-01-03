const _ = LodashGS.load()
const sleep = 5000
const report = {
  success: 0,
  skip: 0,
  error: 0,
}

const onOpen = e => SpreadsheetApp.getUi().createAddonMenu().addItem('スクレイピング実行', 'main').addToUi()

const main = () => {
  deleteTrigger()
  let message = ''
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
  const sheet_id = sheet.getId()
  const sheet_name = 'instagram_data'
  const sql = SpreadSheetsSQL.open(sheet_id, sheet_name)
  const start_time = new Date();

  const lock = LockService.getScriptLock()
  if (! lock.tryLock(1000)) {
    sheet.toast('多重実行のため処理を終了します．')
    return
  }

  try {
    const data = sql.select(['No.', 'tag_name', 'shortcode', 'emdedcode'])
      .filter('No. > NULL AND tag_name > NULL')
      .filter('shortcode = NULL OR emdedcode = NULL')
      .result()

      if (! data) {
        message = '処理対象データが無いため終了します．'
        return 
      }

      for (let i in data) {
        if (isStop(start_time)) {
          // 未処理件数があるため1分後にトリガーセット．
          ScriptApp.newTrigger('main').timeBased().after(60 * 1000).create()
          message = 'GASの実行時間制限(上限6分)に伴い終了します．1分後にトリガーからバックグラウンドで実行します．'
          break
        }

        try {
          const shortcode = (new ShortCode()).main(data[i]['tag_name'])
          let emdedcode = 'NULL'
          if (shortcode != 'NULL') {
            emdedcode = (new EmdedCode()).main(shortcode)
          }

          if (1 < sql.select(['No.']).filter(`No. = ${data[i]['No.']}`).length) {
            report.skip++
            message = '同一PKが複数存在するため更新処理を行いません．'
            continue
          }

          // 更新
          sql.updateRows({shortcode, emdedcode}, `No. = ${data[i]['No.']}`)
          report.success++
        } catch (e) {
          report.error++
          console.error(e.message)
          sheet.toast(e.message)
        } finally {
          Utilities.sleep(sleep)
        }
      }
  } catch (e) {
    console.error(e.message)
    sheet.toast(e.message)
  } finally {
    console.log(message)
    sheet.toast(message)
    lock.releaseLock()
  }
  console.info(report)
}

const isStop = (start_time) => {
  const current_time = new Date();
  //5分を超えたらGASの自動停止を回避するべく終了処理に移行する.
  return 5 <= (current_time.getTime() - start_time.getTime()) / (1000 * 60)
}


/** class */
class InstagramApi {
  main (param) {
    try {
      const res = this.fetch(param)
      const parsed = this.parse(res)
      if (! parsed) throw new Error``
      return this.seek(parsed)
    } catch (e) {
      console.log(e)
      return 'NULL'
    }
  }

  // override
  fetch () {}

  // override
  parse () {}

  // override
  seek () {}
}

class ShortCode extends InstagramApi {
  fetch (tag_name) {
    const url = `https://www.instagram.com/graphql/query/?query_hash=298b92c8d7cad703f7565aa892ede943&variables={"tag_name":"${tag_name}","first":20}`
    return UrlFetchApp.fetch(encodeURI(url)).getContentText()
  }

  parse (data) {
    const res = JSON.parse(data)
    if (! _.has(res, 'data.hashtag.edge_hashtag_to_top_posts.edges.0')) {
      return false
    }

    return _.get(res, 'data.hashtag.edge_hashtag_to_top_posts.edges').map(e => {
      return {
        shortcode: _.get(e, 'node.shortcode'),
        edge_liked_by: _.get(e, 'node.edge_liked_by.count')
      }
    })
  }
  
  seek (data) {
    // instagram選定の人気の写真トップを採用.
    return _.get(data, ('0.shortcode'))
  }
}

class EmdedCode extends InstagramApi {
  fetch (shortcode) {
    const url = `https://api.instagram.com/oembed/?url=https://www.instagram.com/p/${shortcode}&hidecaption=1&maxwidth=540`
    const params = {
      "headers" : {"x-ig-app-id": "936619743392459"}
    }
    return UrlFetchApp.fetch(encodeURI(url), params).getContentText()
  }

  parse (data) {
    return JSON.parse(data)
  }

  seek (data) {
    return data.html
  }
}

const deleteTrigger = () => {
  const triggers = ScriptApp.getProjectTriggers()
  for (let i in triggers) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
}