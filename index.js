import {publicIpv4, publicIpv6} from 'public-ip';
import axios from "axios";
import configFile from './config.json' assert {type: 'json'};
import fs from 'fs'
const debug = false

async function update(config, index) {

  try {
    // Load Config
    if (!config.hostname) {
      throw Error('Hostname missing')
    }
    let cfAuthHeaders = {}
    if (config.bearerToken) {
      cfAuthHeaders = {
        'Authorization': `Bearer ${config.bearerToken}`
      }
    } else if (config.email && config.token) {
      cfAuthHeaders = {
        'X-Auth-Email': config.email,
        'X-Auth-Key': config.token
      }
    } else {
      throw Error('Bearer Token or (Email + Key) missing')
    }

    console.log("DNS Record update for", config.hostname + "...")

    // Get Zone ID
    const cfZoneIdReqUrl = `https://api.cloudflare.com/client/v4/zones?name=${encodeURI(`${config.hostname.split('.').reverse()[1]}.${config.hostname.split('.').reverse()[0]}`)}`
    const cfZoneIdRes = await axios.get(cfZoneIdReqUrl, { headers: cfAuthHeaders })
    if (cfZoneIdRes.data.result.length <= 0) { throw Error('Zone not found') }
    const cfZoneId = cfZoneIdRes.data.result[0].id
    if(debug){console.log('Zone ID:', cfZoneId)}


    // Get DNS Record ID
    const cfDnsIdReqUrl = `https://api.cloudflare.com/client/v4/zones/${encodeURI(cfZoneId)}/dns_records?name=${encodeURI(config.hostname)}`
    const cfDnsIdRes = await axios.get(cfDnsIdReqUrl, { headers: cfAuthHeaders })
    if (cfDnsIdRes.data.result.length <= 0) { throw Error('DNS record not found') }
    const results = await Promise.all(cfDnsIdRes.data.result.map(async cfDnsRecord => {
      if(debug){console.log('DNS Record ID:', cfDnsRecord.id)}
      let content
      switch (cfDnsRecord.type) {
        case 'A':
          content = await publicIpv4()
          break
        case 'AAAA':
          content = await publicIpv6()
          break
        default:
          if(debug){console.error(`DNS Record Type unsupported: ${cfDnsRecord.type}`)}

          return
      }

      //save old ip in config
      config.oldIP = content;
      configFile[index] = config;
      fs.writeFileSync('./config.json', JSON.stringify(configFile, null, 4))


      // Update DNS Record
      const cfPutReqUrl = `https://api.cloudflare.com/client/v4/zones/${encodeURI(cfZoneId)}/dns_records/${encodeURI(cfDnsRecord.id)}`
      const cfPutReqData = {
        'type': cfDnsRecord.type,
        'name': cfDnsRecord.name,
        'content': content,
        'proxied': cfDnsRecord.proxied
      }

      return axios.put(cfPutReqUrl, cfPutReqData, { headers: cfAuthHeaders })
    }))
    results.forEach(result => {
      if (!result || !result.data) {
        if(debug){
          console.error(`Warning: null result received, see above for error messages`)
        }
        return
      }
      if (result.data.success === true) {
        console.log(`DNS Record update for ` + config.hostname + ` is success! `, debug ? JSON.stringify(result.data, undefined, 2) : "")
      } else {
        console.error(`DNS Record update for ` + config.hostname + ` failed: `, JSON.stringify(result.data.errors, undefined, 2))
      }
    })
  } catch (e) {
    console.error(e)
  }
}

// entry
configFile.forEach((element, index) => {
  if(element.oldIP === undefined){
    update(element, index)
  }else{
    const oldIP = element.oldIP;

    publicIpv4().then(newIP => {
      if(oldIP === newIP){
        console.log("For the Domain " + element.hostname + " is no update necessary.")
      }else {
        update(element, index)
      }
    })
  }
});