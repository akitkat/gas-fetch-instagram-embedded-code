const _ = LodashGS.load()
const sleep = 5000
const emdedcode_base = '<blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/p/%%shortcode%%/" data-instgrm-version="13" style=" background: #fff; border: 0; border-radius: 3px; box-shadow: 0 0 1px 0 rgba(0, 0, 0, 0.5), 0 1px 10px 0 rgba(0, 0, 0, 0.15); margin: 1px; max-width: 540px; min-width: 326px; padding: 0; width: 99.375%; width: -webkit-calc(100% - 2px); width: calc(100% - 2px); "></blockquote>'
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
            emdedcode = emdedcode_base.replace('%%shortcode%%', shortcode)
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

class ShortCode {
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

const deleteTrigger = () => {
  const triggers = ScriptApp.getProjectTriggers()
  for (let i in triggers) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
}