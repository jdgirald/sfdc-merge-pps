'use strict';
const fs = require('fs');
const asyncReadFile = require('./lib/utils/async-read-file');
const asyncXmlParser = require('./lib/utils/async-xml-parser');
const xml2js = require('xml2js');
const extendify = require('extendify');

// Plugin to merge package.xml.
module.exports = (config,logger) => {

  // Check if we have enough config options
  if(typeof config.pps === 'undefined' || config.pps === null) {
    throw new Error('Not enough config options');
  }

  // The module return this promise
  // This is where the job is done
 return new Promise((resolve, reject) => {
    Promise.all(config.packages.map(x=>asyncReadFile(x).then(asyncXmlParser)))
    .then(pkgs => {
      // Store max version;
      const pkg = {};
      pkg.version = Math.max(...pkgs.map(p=>p.Package.version[0]));
      pkgs.forEach(p=>p.Package.types.reduce((r,e)=>pkg[e.name[0]] = [...new Set((pkg[e.name[0]] || []).concat(e.members))],pkg))

      fs.writeFileSync(config.output, packageBuilder(pkg));
    })
    .catch(err =>
      reject(new Error(err))
    );
  });

  // The module return this promise
  // This is where the job is done
  return new Promise((resolve, reject) => {
    // First fetch the Admin profile
    // It will be used as a template to complete other profiles & PS
    // Turn all its attribut to false to merge
    parseStringAsync({
      'name':ADMIN_PROFILE_PATH,
      'content': fs.readFileSync(config.src + ADMIN_PROFILE_PATH,"utf8"),
      'type': 'Profile'
    }).then(adminProfile => {
      return {'content':{'Profile':{'userPermissions':JSON.parse(JSON.stringify(adminProfile.content.Profile.userPermissions).replace(/true/g, 'false'))}}};
    }).then(adminProfile => {
      return Promise.all(
          [...fs.readdirSync(config.src + '/profiles',{encoding:'utf8'}).map(filename => '/profiles/'+filename),
           ...fs.readdirSync(config.src + '/permissionsets',{encoding:'utf8'}).map(filename => '/permissionsets/'+filename)]
        .filter(filename => {
        if(filename !== ADMIN_PROFILE_PATH){
          // treat all other P|P&S
          return parseStringAsync({
            'name':filename,
            'content': fs.readFileSync(config.src + filename,"utf8"),
            'type': filename.startsWith('/profiles') ? 'Profile':'PermissionSet'
          }).then(permission=>{
            if(!permission.content[permission.type].hasOwnProperty('userPermissions')){
              permission.content[permission.type].userPermissions = [];
            }
            let myExtend = extendify({
              inPlace: false,
              isDeep: true,
              arrays : 'merge'
            });

            // merge the admin profile user permission with the current P|P&S
            // reduce it to an object with the user permission and the value
            // => merge is done on array of object so user permissions are duplicated
            // => By doing it we merge them
            // map it to the metadata structure
            permission.content[permission.type].userPermissions = Object.entries(
              myExtend(
                adminProfile.content.Profile,permission.content[permission.type]
              ).userPermissions
              .reduce((result,userPermission) => {
                  result[userPermission.name[0]] = result[userPermission.name[0]] || userPermission.enabled[0];
                  return result;
              },{})
            ).map(([userPermission,enabled]) => {
              return {'enabled': [enabled],'name':[userPermission]}
            });

            // sort the attributes to be compliant with the metadata api
            permission.content[permission.type] = Object.keys(permission.content[permission.type])
            .sort()
            .reduce((obj, key) => {
              obj[key]= permission.content[permission.type][key];
              return obj;
            }, {})

            // put the json back to xml and write it
            let builder = new xml2js.Builder({'xmldec': { 'version': '1.0', 'encoding': 'UTF-8'}});
            fs.writeFileSync(config.src + permission.name,builder.buildObject(permission.content));
            logger(permission.name + ' Complete');
            return permission;
          });
        }
      })) 
    }).then(permissions => {
      logger('Completion all achieved');
      resolve(); // we are done
    }).catch(err =>
      reject(new Error(err))
    );
  });
};