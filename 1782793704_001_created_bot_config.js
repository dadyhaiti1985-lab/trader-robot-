/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "createRule": "@request.auth.id != ''",
    "deleteRule": "userId = @request.auth.id",
    "fields":     [
          {
                "autogeneratePattern": "[a-z0-9]{15}",
                "hidden": false,
                "id": "text1376581354",
                "max": 15,
                "min": 15,
                "name": "id",
                "pattern": "^[a-z0-9]+$",
                "presentable": false,
                "primaryKey": true,
                "required": true,
                "system": true,
                "type": "text"
          },
          {
                "hidden": false,
                "id": "text2550461326",
                "name": "userId",
                "presentable": false,
                "primaryKey": false,
                "required": true,
                "system": false,
                "type": "text",
                "autogeneratePattern": "",
                "max": 0,
                "min": 0,
                "pattern": ""
          },
          {
                "hidden": false,
                "id": "number3587188704",
                "name": "riskPerTrade",
                "presentable": false,
                "primaryKey": false,
                "required": false,
                "system": false,
                "type": "number",
                "max": 3,
                "min": 0.5,
                "onlyInt": false
          },
          {
                "hidden": false,
                "id": "number2019239412",
                "name": "maxConcurrentPositions",
                "presentable": false,
                "primaryKey": false,
                "required": false,
                "system": false,
                "type": "number",
                "max": 5,
                "min": 1,
                "onlyInt": false
          },
          {
                "hidden": false,
                "id": "number9232946169",
                "name": "dailyLossLimit",
                "presentable": false,
                "primaryKey": false,
                "required": false,
                "system": false,
                "type": "number",
                "max": 10,
                "min": 2,
                "onlyInt": false
          },
          {
                "hidden": false,
                "id": "number8431628053",
                "name": "trailingStopPercent",
                "presentable": false,
                "primaryKey": false,
                "required": false,
                "system": false,
                "type": "number",
                "max": 100,
                "min": 0,
                "onlyInt": false
          },
          {
                "hidden": false,
                "id": "bool7740158048",
                "name": "assetRotationEnabled",
                "presentable": false,
                "primaryKey": false,
                "required": false,
                "system": false,
                "type": "bool"
          },
          {
                "hidden": false,
                "id": "number9386811366",
                "name": "timeframeWeights15m",
                "presentable": false,
                "primaryKey": false,
                "required": false,
                "system": false,
                "type": "number",
                "max": 100,
                "min": 0,
                "onlyInt": false
          },
          {
                "hidden": false,
                "id": "number4504193492",
                "name": "timeframeWeights4h",
                "presentable": false,
                "primaryKey": false,
                "required": false,
                "system": false,
                "type": "number",
                "max": 100,
                "min": 0,
                "onlyInt": false
          },
          {
                "hidden": false,
                "id": "number6808612948",
                "name": "timeframeWeights1d",
                "presentable": false,
                "primaryKey": false,
                "required": false,
                "system": false,
                "type": "number",
                "max": 100,
                "min": 0,
                "onlyInt": false
          },
          {
                "hidden": false,
                "id": "autodate6175429734",
                "name": "created",
                "onCreate": true,
                "onUpdate": false,
                "presentable": false,
                "system": false,
                "type": "autodate"
          },
          {
                "hidden": false,
                "id": "autodate9757328731",
                "name": "updated",
                "onCreate": true,
                "onUpdate": true,
                "presentable": false,
                "system": false,
                "type": "autodate"
          }
    ],
    "id": "pbc_5911800219",
    "indexes": [],
    "listRule": "userId = @request.auth.id",
    "name": "bot_config",
    "system": false,
    "type": "base",
    "updateRule": "userId = @request.auth.id",
    "viewRule": "userId = @request.auth.id"
  });

  try {
    return app.save(collection);
  } catch (e) {
    if (e.message.includes("Collection name must be unique")) {
      console.log("Collection already exists, skipping");
      return;
    }
    throw e;
  }
}, (app) => {
  try {
    const collection = app.findCollectionByNameOrId("pbc_5911800219");
    return app.delete(collection);
  } catch (e) {
    if (e.message.includes("no rows in result set")) {
      console.log("Collection not found, skipping revert");
      return;
    }
    throw e;
  }
})