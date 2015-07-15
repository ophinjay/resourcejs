var http = require("./http");
var Commons = require("./common");
var Promise = require("./promise");

function createResourceClass(pathTemplate, fields, services) {
    var resourceClass = getConstructor();
    resourceClass._pathTemplate = pathTemplate;
    resourceClass._fields = fields;
    resourceClass.get = getResource;
    userServices = addUserServices(resourceClass, pathTemplate, fields, services);
    Commons.mixin([resourceProto, userServices.instanceFns], resourceClass.prototype);
    Commons.mixin(userServices.classFns, resourceClass);
    return resourceClass;
}

function getConstructor() {
    return function(data) {
        data && setData.call(this, data);
    };
}

function getField(config) {
    if(typeof config == 'string') {
        return config;
    } else if(typeof config == 'object') {
        return config.name;
    }
}

function setData(data, responsePath) {
    this._originalData = data;
    data = resolveResponsePath(data, responsePath);
    if (data) {
        var fields = this.constructor._fields;
        for (var i = 0; i < fields.length; i++) {
            var field = getField(fields[i]);
            var value = data[field];
            if(fields[i].toViewData) {
                value = fields[i].toViewData(value);
            }
            this[field] = value;
        }
    }
}

function resolveResponsePath(data, responsePath) {
    var returnData = data;
    if (responsePath) {
        for (var i = 0; i < responsePath.length; i++) {
            returnData = returnData[responsePath[i]];
        }
    }
    return returnData;
}

function resolvePath(path, data) {
    return path.replace(/:(.*?)(\/|$)/g, function(match, p1, p2) {
        var value = data[p1];
        if (value && value.length > 0) {
            return value + p2;
        } else {
            return "";
        }
    }).replace(/\/$/, "");
}

function getResource(data) {
    var resourceClass = this;
    return Promise.create(function(resolve, reject) {
        path = resolvePath(resourceClass._pathTemplate, data);
        http.get(path).send()
            .then(function(data) {
                parseAndCreateResource(resolve, reject, resourceClass, data, true);
            })
            .catch(serviceFailed.bind(null, reject));
    });
}

function resolveObject(obj, data) {
    var resolvedObj = {};
    if (obj) {
        for (var i in obj) {
            var mapping = obj[i];
            if (/^:/.test(mapping)) {
                var variable = mapping.slice(1);
                resolvedObj[i] = data[variable];
            } else {
                resolvedObj[i] = mapping;
            }
        }
    }
    return resolvedObj;
}

function addUserServices(resourceClass, pathTemp, fields, services) {
    var instanceFns = {};
    var classFns = {};
    for (var i in services) {
        var service = services[i];
        var path = service.path ? service.path : pathTemp;
        (service.isInstance ? instanceFns : classFns)[i] = getGenericExecutor(resourceClass, service, path);
    }
    return {
        instanceFns: instanceFns,
        classFns: classFns
    };
}

function getGenericExecutor(resourceClass, service, pathTemp) {
    return function(data) {
        return genericExecutor.call(this, resourceClass, service, pathTemp, data);
    };
}

function genericExecutor(resourceClass, service, pathTemp, data) {
    var method = service.method || "GET";
    if (service.response) {
        var responsePath = service.response.path;
        responsePath = (typeof responsePath == 'string') ? [responsePath] : responsePath;
    }
    var isInstance = service.isInstance;
    var queriesTemp = service.queries;
    var postDataTemp = service.data;
    if (isInstance) {
        data = Commons.mixin(data, this._data());
    }
    data = data || this;
    return Promise.create(function(resolve, reject) {
        http[method.toLowerCase()](resolvePath(pathTemp, data))
            .queries(resolveObject(queriesTemp, data))
            .send(resolveObject(postDataTemp, data))
            .then(function(data) {
                parseAndCreateResource.call(this, resolve, reject, resourceClass, data, responsePath);
            })
            .catch(serviceFailed.bind(null, reject));
    });
}

function parseAndCreateResource(resolveFn, rejectFn, resourceClass, data, responsePath, updateObj) {
    try {
        var json = JSON.parse(data);
        var resourceObj = this;
        if (json instanceof Array) {
            resourceObj = [];
            for(var i = 0; i < json.length; i++) {
                var obj = new resourceClass();
                setData.call(obj, json[i], responsePath);
                resourceObj.push(obj);
            }
        } else {
            if (!updateObj) {
                resourceObj = new resourceClass();
            }
            setData.call(resourceObj, json, responsePath);
        }
        resolveFn(resourceObj);
    } catch (ex) {
        resolveFn(data);
    }
}

function serviceFailed(rejectFn, e) {
    rejectFn(e);
}

var resourceProto = (function() {

    function getPath(resourceObj) {
        return resolvePath(resourceObj.constructor._pathTemplate, resourceObj);
    }

    var deleteResource = function() {
        var that = this;
        return Promise.create(function(resolve, reject) {
            http.delete(getPath(that)).send()
                .then(function(data) {
                    parseAndCreateResource(resolve, reject, that.constructor, data);
                })
                .catch(serviceFailed.bind(null, reject));
        });
    };

    var saveResource = function() {
        var that = this;
        return Promise.create(function(resolve, reject) {
            http.put(getPath(that)).send(that._data())
                .then(function(data) {
                    parseAndCreateResource(resolve, reject, that.constructor, data, true, false);
                })
                .catch(serviceFailed.bind(null, reject));
        });
    };

    var getData = function() {
        var fields = this.constructor._fields;
        var data = {};
        for (var i = 0; i < fields.length; i++) {
            var field = getField(fields[i]);
            var value = this[field];
            if(fields[i].toResourceData) {
                value = fields[i].toResourceData(value);
            }
            data[field] = value;
        }
        return data;
    };

    return {
        "delete": deleteResource,
        "save": saveResource,
        "_data": getData
    };

})();

/**
 * Validate the path template provided. Does not check for URL validity as a whole. Just ensures that the user has not
 * specified an empty variable(/:/)
 */
function validatePath(pathTemplate) {
    if (!pathTemplate) {
        return "/";
    } else {
        var isValid = pathTemplate.slice(1).split("\/").every(function(pathPart) {
            return /:?.+/.test(pathPart);
        });
        return isValid && pathTemplate;
    }
}

module.exports = function(pathTemplate, fields, services) {
    var result = validatePath(pathTemplate);
    if (!result) {
        throw new Error("Invalid path template provided!!");
    }
    return createResourceClass(result, fields, services);
};