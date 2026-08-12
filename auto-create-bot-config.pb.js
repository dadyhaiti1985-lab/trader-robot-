/// <reference path="../pb_data/types.d.ts" />
onRecordAfterCreateSuccess((e) => {
  const botConfigCollection = $app.findCollectionByNameOrId("botConfig");
  const botConfig = new Record(botConfigCollection);
  
  botConfig.set("userId", e.record.id);
  botConfig.set("symbol", "BTC-USD");
  botConfig.set("strategy", "EMA_RSI");
  botConfig.set("stopLoss", 2);
  botConfig.set("takeProfit", 5);
  botConfig.set("isActive", false);
  
  $app.dao().saveRecord(botConfig);
  
  e.next();
}, "users");