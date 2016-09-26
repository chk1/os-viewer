'use strict';

var _ = require('lodash');
var visualizationsService = require('../visualizations');

var defaultOrderByDirection = 'desc';

function cloneState(state) {
  return _.cloneDeep(state);
}

function getDefaultState(variablePart) {
  return _.extend({
    measures: [],
    groups: [],
    series: [],
    rows: [],
    columns: [],
    filters: {},
    orderBy: {},
    visualizations: [],
    lang: 'en'
  }, variablePart);
}

function normalizeUrlParams(params, packageModel) {
  var result = {};

  if (!!params.measure) {
    result.measures = [params.measure];
  }

  _.each(['groups', 'series', 'rows', 'columns'], function(axis) {
    if (!!params[axis]) {
      if (_.isArray(params[axis])) {
        result[axis] = params[axis];
      } else {
        result[axis] = [params[axis]];
      }
      result[axis] = _.filter(result[axis]);
    }
  });

  if (!!params.filters) {
    result.filters = params.filters;
    if (_.isArray(params.filters)) {
      result.filters = _.chain(params.filters)
        .map(function(value) {
          value = value.split('|');
          if (value.length == 2) {
            return value;
          }
        })
        .filter()
        .fromPairs()
        .value();
    }
  }

  if (!!params.order) {
    var orderBy = params.order.split('|');
    if (orderBy.length == 2) {
      result.orderBy = {
        key: orderBy[0],
        direction: orderBy[1]
      };
    }
  }

  result.visualizations = [];
  if (!!params.visualizations) {
    if (_.isArray(params.visualizations)) {
      result.visualizations = params.visualizations;
    } else {
      result.visualizations = [params.visualizations];
    }
    result.visualizations = _.filter(result.visualizations);
  }

  result.lang = 'en';
  if (!!params.lang) {
    result.lang = params.lang;
  }

  return result;
}

function validateUrlParams(params, packageModel) {
  var result = {};

  result.lang = params.lang;

  var visualizations = visualizationsService.getVisualizationsByIds(
    params.visualizations);
  if (visualizations.length == 0) {
    return result;
  }

  var type = _.first(visualizations).type;
  var defaults = {};
  switch (type) {
    case 'drilldown':
    case 'sortable-series':
      initCommonParams(defaults, packageModel);
      if (type == 'sortable-series') {
        defaults.series = [];
      }
      break;
    case 'time-series':
      initParamsForTimeSeries(defaults, packageModel);
      break;
    case 'location':
      initParamsForLocation(defaults, packageModel);
      break;
    case 'pivot-table':
      initParamsForPivotTable(defaults, packageModel);
      break;
  }
  defaults.filters = {};

  _.each(defaults, function(unused, key) {
    result[key] = params[key] || defaults[key];
  });

  result.visualizations = _.chain(visualizations)
    .filter({type: type})
    .map(function(item) {
      return item.id;
    })
    .value();

  return result;
}

function init(packageModel, initialParams) {
  var anyDateTimeHierarchy = _.first(packageModel.dateTimeHierarchies);
  initialParams = normalizeUrlParams(initialParams || {}, packageModel);
  initialParams = validateUrlParams(initialParams, packageModel);

  var defaults = getDefaultState({
    packageId: packageModel.id,
    countryCode: packageModel.meta.countryCode,
    dateTimeDimension: _.first(anyDateTimeHierarchy.dimensions).key
  });

  return _.extend(defaults, initialParams);
}

function changeMeasure(state, measure) {
  var result = cloneState(state);
  var orderByIsMeasure = result.measures.indexOf(result.orderBy.key) >= 0;
  result.measures = [measure];
  if (orderByIsMeasure) {
    result.orderBy.key = measure;
    result.orderBy.direction = defaultOrderByDirection;
  }
  return result;
}

function changeFilter(state, filter, filterValue) {
  var result = cloneState(state);

  result.filters[filter] = _.filter(result.filters[filter], function(value) {
    return value != filterValue;
  });
  result.filters[filter].push(filterValue);

  return result;
}

function clearFilter(state, filter, value) {
  var result = cloneState(state);
  if (_.isUndefined(value)) {
    delete result.filters[filter];
  } else {
    result.filters[filter] = _.filter(result.filters[filter], function(item) {
      return item != value;
    });
    if (result.filters[filter].length == 0) {
      delete result.filters[filter];
    }
  }
  return result;
}

function clearFilters(state) {
  var result = cloneState(state);
  result.filters = {};
  return result;
}

function updateSourceTarget(params, packageModel) {
  params.source = undefined;
  params.target = undefined;

  var groupKey = _.first(params.groups);
  var hierarchy = _.find(packageModel.hierarchies, function(hierarchy) {
    return !!_.find(hierarchy.dimensions, {key: groupKey});
  });

  if (hierarchy && (hierarchy.dimensions.length > 0)) {
    // Find source and target dimensions.
    // `source` should be selected dimension, and `target` - next
    // dimension to selected. If selected last dimension, then
    // last dimension is `target` and previous to it - `source`
    var source = null;
    var target = null;
    _.each(hierarchy.dimensions, function(item) {
      if (source && (source.key == groupKey)) {
        target = item;
        return false;
      }
      if (item.key == groupKey) {
        source = item;
      }
    });
    if (source && !target) {
      target = source;
      source = _.last(_.dropRight(hierarchy.dimensions, 1));
      if (!source) {
        source = target;
      }
    }

    params.source = source ? source.key : undefined;
    params.target = target ? target.key : undefined;
  }

  return params;
}

function changeDimension(state, axis, dimension, packageModel) {
  var result = cloneState(state);

  var isSingleSelect = false;

  // All types are multi-select, except of `groups` (in all cases) and
  // `series` (when `time-series` vis selected)
  if (axis == 'groups') {
    isSingleSelect = true;
  }
  if (axis == 'series') {
    var visualization = visualizationsService.getVisualizationById(
      _.first(result.visualizations));
    if (visualization) {
      if (visualization.type == 'time-series') {
        isSingleSelect = true;
      }
    }
  }

  if (isSingleSelect) {
    var orderByIsGroup = false;
    if (axis == 'groups') {
      orderByIsGroup = result.groups.indexOf(result.orderBy.key) >= 0;
    }
    result[axis] = [dimension];
    if (orderByIsGroup) {
      result.orderBy.key = dimension;
      result.orderBy.direction = defaultOrderByDirection;
    }
  } else {
    result[axis] = _.filter(result[axis], function(value) {
      return value != dimension;
    });
    result[axis].push(dimension);
  }

  // Update `source` and `target` when changing group
  if (axis == 'groups') {
    updateSourceTarget(result, packageModel);
  }

  return result;
}

function clearDimension(state, axis, dimension, packageModel) {
  var result = cloneState(state);
  result[axis] = _.filter(result[axis], function(value) {
    return value != dimension;
  });

  // Update `source` and `target` when changing group
  if (axis == 'groups') {
    updateSourceTarget(result, packageModel);
  }

  return result;
}

function clearDimensions(state, axis) {
  var result = cloneState(state);
  result[axis] = [];

  if (axis == 'groups') {
    result.source = undefined;
    result.target = undefined;
  }

  return result;
}

function drillDown(state, drillDownValue, packageModel) {
  var result = cloneState(state);

  var groupKey = _.first(result.groups);
  var hierarchy = _.find(packageModel.hierarchies, function(hierarchy) {
    return !!_.find(hierarchy.dimensions, {key: groupKey});
  });

  if (hierarchy) {
    var index = _.findIndex(hierarchy.dimensions, {key: groupKey});
    index += 1;
    if (index <= hierarchy.dimensions.length - 1) {
      var nextGroup = hierarchy.dimensions[index];
      result.filters[groupKey] = result.filters[groupKey] || [];
      result.filters[groupKey].push(drillDownValue);
      result.groups = [nextGroup.key];
    }
  }

  updateSourceTarget(result, packageModel);

  return result;
}

function applyBreadcrumb(state, breadcrumb, packageModel) {
  var result = cloneState(state);

  result.groups = breadcrumb.groups;
  result.filters = breadcrumb.filters;

  updateSourceTarget(result, packageModel);

  return result;
}

function changeOrderBy(state, key, direction) {
  direction = ('' + direction).toLowerCase();
  var result = cloneState(state);
  result.orderBy = {
    key: key,
    direction: (direction == 'desc') ? 'desc' : 'asc'
  };
  return result;
}

// Functions for initializing params according to added visualizations

function initCommonParams(params, packageModel) {
  var measure = _.first(packageModel.measures);
  var hierarchy = _.first(packageModel.hierarchies);
  var dimension = _.first(hierarchy.dimensions);

  params.measures = [measure.key];
  params.groups = [dimension.key];
  params.orderBy = {
    key: measure.key,
    direction: defaultOrderByDirection
  };

  updateSourceTarget(params, packageModel);
}

function initParamsForTimeSeries(params, packageModel) {
  var measure = _.first(packageModel.measures);

  params.measures = [measure.key];
  params.groups = [];
  params.series = [];
  params.orderBy = {};
}

function initParamsForLocation(params, packageModel) {
  var measure = _.first(packageModel.measures);
  var hierarchy = _.first(packageModel.locationHierarchies);
  var dimension = _.first(hierarchy.dimensions);

  params.measures = [measure.key];
  params.groups = [dimension.key];
  params.orderBy = {
    key: measure.key,
    direction: defaultOrderByDirection
  };
}

function initParamsForPivotTable(params, packageModel) {
  var measure = _.first(packageModel.measures);

  var hierarchy = _.first(packageModel.hierarchies);
  var rowDimension = _.first(hierarchy.dimensions);

  // Choose dimension for columns. First try to find `datetime` dimension
  // with more than one value; if such dimension not found - try any other
  hierarchy = _.first(packageModel.columnHierarchies);
  var columnDimension = _.first(hierarchy.dimensions);
  _.each(packageModel.columnHierarchies, function(hierarchy) {
    var dimension = _.find(hierarchy.dimensions, {
      dimensionType: 'datetime'
    });
    if (dimension && dimension.values) {
      if (dimension.values.length > 1) {
        columnDimension = dimension;
        return false;
      }
    }
  });

  params.measures = [measure.key];
  params.rows = [rowDimension.key];
  params.columns = [columnDimension.key];
  params.orderBy = {
    key: measure.key,
    direction: defaultOrderByDirection
  };
}

function initParams(params, packageModel) {
  var visualization = visualizationsService.getVisualizationById(
    _.first(params.visualizations));
  switch (visualization.type) {
    case 'drilldown':
    case 'sortable-series':
      initCommonParams(params, packageModel);
      break;
    case 'time-series':
      initParamsForTimeSeries(params, packageModel);
      break;
    case 'location':
      initParamsForLocation(params, packageModel);
      break;
    case 'pivot-table':
      initParamsForPivotTable(params, packageModel);
      break;
  }
}

function clearParams(params, packageModel) {
  params.measures = [];
  params.groups = [];
  params.series = [];
  params.rows = [];
  params.columns = [];
  params.source = undefined;
  params.target = undefined;
  params.filters = {};
  params.orderBy = {};
  params.visualizations = [];
}

function addVisualization(state, visualizationId, toggle, packageModel) {
  var result = cloneState(state);

  var alreadyAdded = !!_.find(state.visualizations, function(item) {
    return item == visualizationId;
  });

  if (alreadyAdded) {
    if (toggle) {
      result.visualizations = _.filter(result.visualizations, function(item) {
        return item != visualizationId;
      });
    }
  } else {
    result.visualizations.push(visualizationId);
  }

  if (result.visualizations.length == 0) {
    clearParams(result, packageModel);
  }
  if (result.visualizations.length == 1) {
    initParams(result, packageModel);
  }

  return result;
}

function removeVisualization(state, visualizationId, packageModel) {
  var result = cloneState(state);
  result.visualizations = _.filter(result.visualizations, function(item) {
    return item != visualizationId;
  });
  if (result.visualizations.length == 0) {
    clearParams(result, packageModel);
  }
  return result;
}

function removeAllVisualizations(state, packageModel) {
  var result = cloneState(state);
  result.visualizations = [];
  clearParams(result, packageModel);
  return result;
}

function updateFromParams(state, urlParams, packageModel) {
  urlParams = normalizeUrlParams(urlParams || {}, packageModel);
  urlParams = validateUrlParams(urlParams, packageModel);
  var result = _.extend(cloneState(state), getDefaultState(), urlParams);
  updateSourceTarget(result, packageModel);
  return result;
}

module.exports.init = init;
module.exports.changeMeasure = changeMeasure;
module.exports.changeFilter = changeFilter;
module.exports.clearFilter = clearFilter;
module.exports.clearFilters = clearFilters;
module.exports.changeDimension = changeDimension;
module.exports.clearDimension = clearDimension;
module.exports.clearDimensions = clearDimensions;
module.exports.drillDown = drillDown;
module.exports.applyBreadcrumb = applyBreadcrumb;
module.exports.addVisualization = addVisualization;
module.exports.removeVisualization = removeVisualization;
module.exports.removeAllVisualizations = removeAllVisualizations;
module.exports.changeOrderBy = changeOrderBy;
module.exports.updateFromParams = updateFromParams;
