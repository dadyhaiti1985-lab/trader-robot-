/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("botConfig");

  const existing = collection.fields.getByName("takeProfit");
  if (existing) {
    if (existing.type === "number") {
      return; // field already exists with correct type, skip
    }
    collection.fields.removeByName("takeProfit"); // exists with wrong type, remove first
  }

  collection.fields.add(new NumberField({
    name: "takeProfit",
    required: true,
    min: 0.1
  }));

  return app.save(collection);
}, (app) => {
  try {
    const collection = app.findCollectionByNameOrId("botConfig");
    collection.fields.removeByName("takeProfit");
    return app.save(collection);
  } catch (e) {
    if (e.message.includes("no rows in result set")) {
      console.log("Collection not found, skipping revert");
      return;
    }
    throw e;
  }
})