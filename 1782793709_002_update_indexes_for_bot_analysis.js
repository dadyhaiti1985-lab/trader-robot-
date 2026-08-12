/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("bot_analysis");
  collection.indexes.push("CREATE INDEX idx_bot_analysis_userId_asset_timeframe ON bot_analysis (userId, asset, timeframe)");
  return app.save(collection);
}, (app) => {
  try {
  const collection = app.findCollectionByNameOrId("bot_analysis");
  collection.indexes = collection.indexes.filter(idx => !idx.includes("idx_bot_analysis_userId_asset_timeframe"));
  return app.save(collection);
  } catch (e) {
    if (e.message.includes("no rows in result set")) {
      console.log("Collection not found, skipping revert");
      return;
    }
    throw e;
  }
})