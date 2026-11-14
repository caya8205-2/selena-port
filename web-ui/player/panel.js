"use strict";
const $=s=>document.querySelector(s);
let me=null,catalog=null,busy=false;
function notice(s){$("#notice").textContent=s;}
function locked(){
  me=null;catalog=null;$("#workspace").classList.add("hidden");$("#loginPanel").classList.remove("hidden");
  $("#identity").textContent="";$("#execute").disabled=true;$("#response").textContent="Waiting for an action…";
}
async function api(path,body){
  const headers={};
  if(body!==undefined){headers["Content-Type"]="application/json";headers["X-Player-Client"]="1";
    if(me)headers["X-Player-CSRF"]=me.csrf;}
  const response=await fetch("/api/player/"+path,{method:body===undefined?"GET":"POST",headers,
    credentials:"same-origin",cache:"no-store",body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok){if(response.status===401)locked();const error=new Error(data.msg||"Request failed");error.status=response.status;throw error;}
  return data;
}
function kindRows(){
  switch($("#kind").value){case"item":return catalog?.items||[];case"character":case"coating":return catalog?.characters||[];
    case"equip":return catalog?.equips||[];case"stage":return catalog?.stages||[];default:return[];}
}
function fillObjects(){
  const q=$("#search").value.trim().toLowerCase(),select=$("#object");select.replaceChildren();
  const rows=kindRows().filter(r=>(String(r.name)+" "+r.id).toLowerCase().includes(q)).slice(0,200);
  for(const row of rows){const option=document.createElement("option");option.value=String(row.id);
    option.textContent=String(row.name||"Unnamed")+" · "+row.id;select.appendChild(option);}
  preview();
}
function operation(){
  const id=$("#object").value;
  switch($("#kind").value){
    case"item":return id?{command:"item",args:["add",id,$("#quantity").value]}:null;
    case"character":return id?{command:"character",args:["add",id]}:null;
    case"equip":return id?{command:"equip",args:["add",id]}:null;
    case"coating":return id?{command:"coating",args:["unlock",id]}:null;
    case"scene":return{command:"scene",args:["unlock","all"]};
    case"level":return{command:"level",args:[$("#level").value]};
    case"stage":return id?{command:"stage",args:[id]}:null;
  }return null;
}
function preview(){
  const op=operation();
  $("#preview").textContent=op?`Target: your UID ${me?.uid??"not logged in"}\n/${op.command} ${op.args.join(" ")}`:"Select a target";
  $("#execute").disabled=busy||!me?.online||!op;
}
function changeKind(){
  const kind=$("#kind").value;$("#search").value="";
  $("#targetFields").classList.toggle("hidden",["scene","level"].includes(kind));
  $("#quantityField").classList.toggle("hidden",kind!=="item");$("#levelField").classList.toggle("hidden",kind!=="level");
  fillObjects();
}
async function load(){
  me=(await api("me")).data;
  $("#identity").textContent=`${me.name} · UID ${me.uid}`;
  $("#online").textContent=me.online?"Game is online - self-service is available.":"Game is offline: you can still clean up your inventory; grant actions need the game open, then refresh.";
  $("#loginPanel").classList.add("hidden");$("#workspace").classList.remove("hidden");
  if(!catalog){catalog=(await api("data")).data;$("#level").max=String(catalog.maxLevel);}
  changeKind();
  document.dispatchEvent(new Event("player-state-loaded"));
}
$("#loginForm").addEventListener("submit",async e=>{
  e.preventDefault();if(busy)return;busy=true;notice("Logging in…");
  try{me=(await api("login",{username:$("#username").value,password:$("#password").value})).data;
    $("#password").value="";catalog=null;await load();notice("This page is bound to your own account - it cannot select other players.");}
  catch(e){notice(e.message);}finally{busy=false;preview();}
});
$("#refresh").addEventListener("click",async()=>{try{await load();notice("Account status refreshed.");}catch(e){notice(e.message);}});
$("#logout").addEventListener("click",async()=>{try{await api("logout",{});locked();notice("Logged out.");}catch(e){notice(e.message);}});
$("#kind").addEventListener("change",changeKind);$("#search").addEventListener("input",fillObjects);
for(const id of["object","quantity","level"])$("#"+id).addEventListener("input",preview);
$("#execute").addEventListener("click",async()=>{
  if(busy||!me?.online)return;const op=operation();if(!op)return;busy=true;preview();notice("Executing…");
  try{const data=await api("exec",op);$("#response").textContent=JSON.stringify(data,null,2);notice(data.msg);}
  catch(e){$("#response").textContent=e.message;notice(e.message);}finally{busy=false;preview();}
});
load().catch(e=>{locked();if(!e.message.includes("Log in first"))notice(e.message);});

"use strict";
(() => {
  let cleanupPlan = null, ownedItems = [], itemRequest = 0, itemsLoading = false;
  const form = $("#cleanupForm"), category = $("#cleanupCategory");
  const search = $("#cleanupItemSearch"), select = $("#cleanupItem");
  function resetCleanup() {
    cleanupPlan = null;
    $("#cleanupConfirm").disabled = true;
    $("#cleanupConfirmation").value = "";
  }
  function fillItems(message) {
    const previous = select.value, query = search.value.trim().toLocaleLowerCase();
    const matches = ownedItems.filter(row => String(row.name).toLocaleLowerCase().includes(query));
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = itemsLoading ? "Reading your inventory…" : "Select items to clean up";
    select.replaceChildren(placeholder);
    for (const row of matches.slice(0, 100)) {
      const option = document.createElement("option");
      option.value = String(row.id);
      option.textContent = `${row.name} × ${row.quantity}`;
      option.title = row.description || "";
      select.appendChild(option);
    }
    select.value = matches.slice(0, 100).some(row => String(row.id) === previous) ? previous : "";
    select.disabled = busy || itemsLoading;
    $("#cleanupItemHint").textContent = message || (itemsLoading ? "Reading normal items in your inventory…" :
      matches.length === 0 ? (query ? "No matching inventory items - try another name or keyword." : "No cleanable normal items in your inventory.") :
      matches.length > 100 ? `Matched ${matches.length} item types; showing the first 100. Type a fuller name to narrow it down.` :
      `Matched ${matches.length} item types; the number after each name is what you own.`);
  }
  async function loadItems() {
    const request = ++itemRequest, uid = me?.uid;
    ownedItems = [];
    resetCleanup();
    if (!uid || category.value !== "items") { itemsLoading = false; fillItems(); return; }
    itemsLoading = true;
    fillItems();
    try {
      const response = await api("cleanup/items"), data = response.data;
      if (request !== itemRequest || me?.uid !== uid || category.value !== "items") return;
      if (data.uid !== uid || !Array.isArray(data.items)) throw new Error("Inventory catalog check failed - please refresh.");
      ownedItems = data.items;
      itemsLoading = false;
      fillItems();
    } catch (error) {
      if (request !== itemRequest || me?.uid !== uid || category.value !== "items") return;
      itemsLoading = false;
      fillItems(error.message);
      notice(error.message);
    }
  }
  function invalidateItems() {
    ++itemRequest;
    ownedItems = [];
    itemsLoading = false;
    search.value = "";
    resetCleanup();
    fillItems();
  }
  function updateCleanupFields() {
    invalidateItems();
    $("#cleanupItemField").classList.toggle("hidden", category.value !== "items");
    $("#cleanupStarField").classList.toggle("hidden", !["weapons", "memories"].includes(category.value));
    $("#cleanupDevelopedField").classList.toggle("hidden", category.value === "items");
    $("#cleanupPreview").textContent = "Exit the game, then choose a scope and preview.";
    if (category.value === "items") loadItems();
  }
  function setControls(disabled) {
    for (const control of form.elements) control.disabled = disabled;
    $("#cleanupConfirmation").disabled = disabled;
    if (!disabled) select.disabled = itemsLoading;
  }
  category.addEventListener("change", updateCleanupFields);
  search.addEventListener("input", () => { resetCleanup(); fillItems(); });
  for (const id of ["cleanupItem", "cleanupStar", "cleanupDeveloped"]) {
    $("#" + id).addEventListener("change", resetCleanup);
  }
  document.addEventListener("player-state-loaded", () => {
    invalidateItems();
    if (category.value === "items") loadItems();
  });
  $("#cleanupConfirmation").addEventListener("input", () => {
    $("#cleanupConfirm").disabled = busy || !cleanupPlan || $("#cleanupConfirmation").value !== "CONFIRM CLEANUP";
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !me) return;
    if (category.value === "items" && (itemsLoading || !select.value)) {
      notice(itemsLoading ? "Inventory is still loading - preview again in a moment." : "Search by name and pick an inventory item first.");
      return;
    }
    busy = true;
    resetCleanup();
    setControls(true);
    try {
      const data = await api("cleanup/preview", {
        category: category.value, itemId: Number(select.value || 0),
        maxStar: Number($("#cleanupStar").value), includeDeveloped: $("#cleanupDeveloped").checked
      });
      const plan = data.data;
      cleanupPlan = plan.count > 0 ? plan : null;
      $("#cleanupPreview").textContent =
        `Your UID ${plan.uid}\nMatching: ${plan.count} items / ${plan.quantity} total\n` +
        (plan.samples || []).map(row => `${row.name} × ${row.quantity}`).join("\n") +
        (plan.count > plan.sampleLimit ? `\nShowing the first ${plan.sampleLimit} only.` : "") +
        "\n" + data.msg;
      notice(data.msg);
    } catch (error) {
      $("#cleanupPreview").textContent = error.message;
      notice(error.message);
    } finally {
      busy = false;
      setControls(false);
      preview();
    }
  });
  $("#cleanupConfirm").addEventListener("click", async () => {
    if (busy || !me || !cleanupPlan || $("#cleanupConfirmation").value !== "CONFIRM CLEANUP") return;
    const plan = cleanupPlan;
    busy = true;
    resetCleanup();
    setControls(true);
    try {
      const data = await api("cleanup/execute", { token: plan.token, confirmation: "CONFIRM CLEANUP" });
      $("#cleanupPreview").textContent = data.msg + `\nCleaned ${data.data.deleted} items, for your UID ${data.data.uid} only.`;
      notice(data.msg);
      if (category.value === "items") await loadItems();
    } catch (error) {
      $("#cleanupPreview").textContent = error.message;
      notice(error.message);
    } finally {
      busy = false;
      setControls(false);
      preview();
    }
  });
  for (const [id, event] of [["logout", "click"], ["loginForm", "submit"], ["refresh", "click"]]) {
    $("#" + id).addEventListener(event, invalidateItems);
  }
  updateCleanupFields();
})();

"use strict";
(() => {
  const form = $("#guildResourceForm"), select = $("#guildResource"), quantity = $("#guildQuantity");
  const submit = $("#guildSubmit"), status = $("#guildStatus"), result = $("#guildResult");
  let state = null, working = false, requestGeneration = 0, pending = null, cooldownUntil = 0;
  const key = () => "pgr-own-guild-pending:" + me?.uid;
  function readPending() {
    try {
      const stored = JSON.parse(localStorage.getItem(key()) || "null");
      pending = stored && stored.uid === me?.uid && /^[0-9a-f]{32}$/.test(stored.requestId) &&
        ["shopCoin", "personalCoin", "experience", "talentPoint", "levelUp"].includes(stored.resource) &&
        Number.isInteger(stored.quantity) && stored.quantity >= 1 && stored.quantity <= 10000 &&
        (stored.resource !== "levelUp" || stored.quantity === 1) ? stored : null;
    } catch { pending = null; }
    if (pending) { select.value = pending.resource; quantity.value = String(pending.quantity); }
  }
  function savePending() {
    try { if (pending) localStorage.setItem(key(), JSON.stringify(pending)); else localStorage.removeItem(key()); }
    catch { /* In-memory retries still use the same request identifier. */ }
  }
  function controls() {
    const cooling = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
    const upgrade = select.value === "levelUp", personal = select.value === "personalCoin";
    if (upgrade) quantity.value = "1";
    select.disabled = working || !!pending;
    quantity.disabled = working || !!pending || upgrade;
    const permitted = personal ? state?.canCreditPersonal : state?.canManage;
    submit.disabled = working || !me || !permitted || !state?.online ||
      (upgrade && !state?.canLevelUp && !pending) || (cooling > 0 && !pending);
    submit.textContent = working ? "Saving…" : pending ? "Verify and retry the same request" :
      cooling > 0 ? `Bureau on cooldown (${cooling}s)` :
      upgrade ? "Spend stored EXP to level up once" : personal ? "Add to your own inventory" : "Add to your bureau";
  }
  function display(data) {
    state = data;
    if (data.uid !== me?.uid) throw new Error("The bureau's account changed - refresh again.");
    if (!data.joined) { status.textContent = "Your account has not joined a bureau yet."; controls(); return; }
    const roles = { 1: "Commander", 2: "Vice Commander", 4: "Member", 5: "Guest" };
    status.textContent = `${data.name} · Lv.${data.level}\nYour role: ${roles[data.rank] || "Member"}\n` +
      `Co-op Merits (purple - guild pool): ${data.shopCoin} / ${data.shopCoinLimit}\n` +
      `Joint Points (blue - personal): ${data.personalCoin}\n` +
      `Member cap: ${data.maxMembers}\nBureau EXP: ${data.experience}` +
      (data.maximumLevel ? "(max level - new EXP converts to Beacon Boost Points per game rules)" : `  / EXP to next level ${data.nextLevelExperience}`) +
      `\nBeacon Boost Points: ${data.talentPoint}\n` +
      (!data.online ? "Enter the game first, then refresh this page." :
        data.canManage ? (data.canLevelUp ? "Enough EXP - you can pick \"Spend stored EXP to level up once\"." : "You can top up the guild pool and your own Joint Points.") :
        data.canCreditPersonal ? "You can top up your own Joint Points; pool resources and upgrades need the Commander or Vice Commander." : "Guests cannot top up resources.");
    cooldownUntil = Date.now() + (data.cooldownSeconds || 0) * 1000;
    controls();
  }
  async function refresh() {
    const generation = ++requestGeneration, uid = me?.uid;
    if (!uid) return;
    try {
      const response = await api("guild");
      if (generation !== requestGeneration || me?.uid !== uid) return;
      display(response.data);
    } catch (error) {
      if (generation !== requestGeneration || me?.uid !== uid) return;
      state = null; status.textContent = error.message; controls();
    }
  }
  document.addEventListener("player-state-loaded", () => {
    state = null; cooldownUntil = 0; readPending(); controls(); refresh();
    result.textContent = pending ? "One request is awaiting verification - retry the same request; anything already applied will not be added twice." : "Results appear here.";
  });
  $("#guildRefresh").addEventListener("click", refresh);
  select.addEventListener("change", controls);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (working || !state?.online || !me) return;
    if (!(select.value === "personalCoin" ? state.canCreditPersonal : state.canManage)) return;
    const uid = me.uid;
    if (!pending) {
      const amount = select.value === "levelUp" ? 1 : Number(quantity.value);
      if (!Number.isInteger(amount) || amount < 1 || amount > 10000) {
        result.textContent = "Amount must be an integer from 1 to 10000."; return;
      }
      const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
      pending = { uid, resource: select.value, quantity: amount,
        requestId: Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("") };
      savePending();
    }
    working = true; controls(); result.textContent = "Verifying your identity and saving…";
    try {
      const response = await api("guild/resources", {
        resource: pending.resource, quantity: pending.quantity, requestId: pending.requestId
      });
      if (me?.uid !== uid) return;
      result.textContent = response.msg;
      pending = null; savePending(); display(response.data); notice(response.msg);
    } catch (error) {
      if (me?.uid !== uid) return;
      result.textContent = error.message;
      // A server/storage/network failure may have committed. Retain this identity for a safe retry.
      if (error.status >= 400 && error.status < 500 && ![401, 429].includes(error.status)) {
        pending = null; savePending();
      }
      notice(error.message);
    } finally { working = false; controls(); }
  });
  setInterval(() => { if (me && state) controls(); }, 1000);
})();

"use strict";
(() => {
  const room = $("#dormDrawingRoom"), template = $("#dormDrawingTemplate");
  const search = $("#dormDrawingSearch"), preview = $("#dormDrawingPreview");
  const buy = $("#dormDrawingBuy"), summary = $("#dormDrawingSummary"), result = $("#dormDrawingResult");
  let templates = [], quote = null, working = false, generation = 0;
  function clearQuote() {
    quote = null; buy.disabled = true; buy.textContent = "Confirm purchase of missing blueprints";
  }
  function invalidate() {
    clearQuote(); summary.textContent = "Selection changed - recalculate missing blueprints and total cost.";
  }
  function options(select, rows, valueOf) {
    select.replaceChildren();
    for (const row of rows) {
      const option = document.createElement("option");
      option.value = valueOf(row); option.textContent = row.name || String(row.id);
      select.appendChild(option);
    }
  }
  function filterTemplates() {
    const query = search.value.trim().toLowerCase();
    const previous = template.value;
    options(template, templates.filter(x => (x.name + " " + x.id).toLowerCase().includes(query)),
      x => x.kind + ":" + x.id);
    if ([...template.options].some(x => x.value === previous)) template.value = previous;
    invalidate();
  }
  function controls() {
    preview.disabled = working || !me || !room.value || !template.value;
    buy.disabled = working || !me || !quote?.canBuy;
    room.disabled = template.disabled = search.disabled = working;
    $("#dormDrawingRefresh").disabled = working;
  }
  async function refresh() {
    const current = ++generation, uid = me?.uid;
    clearQuote(); templates = []; options(room, [], x => x.id); options(template, [], x => x.id);
    controls();
    if (!uid) return;
    summary.textContent = "Reading your dorm and decoration templates…";
    try {
      const response = await api("dorm/drawings");
      if (current !== generation || uid !== me?.uid) return;
      if (response.data.uid !== uid) throw new Error("Account status changed - log in again.");
      const previousRoom = room.value;
      options(room, response.data.rooms, x => String(x.id));
      if ([...room.options].some(x => x.value === previousRoom)) room.value = previousRoom;
      templates = response.data.templates; filterTemplates();
      summary.textContent = `Furniture Coin balance: ${response.data.balance}\nChoose a room and template, then calculate missing blueprints.`;
    } catch (error) {
      if (current === generation && uid === me?.uid) summary.textContent = error.message;
    } finally { if (current === generation) controls(); }
  }
  document.addEventListener("player-state-loaded", () => {
    search.value = ""; result.textContent = "After purchasing, reopen the one-click furniture synthesis page in game.";
    refresh();
  });
  search.addEventListener("input", () => { filterTemplates(); controls(); });
  room.addEventListener("change", () => { invalidate(); controls(); });
  template.addEventListener("change", () => { invalidate(); controls(); });
  $("#dormDrawingRefresh").addEventListener("click", refresh);
  $("#dormDrawingForm").addEventListener("submit", async event => {
    event.preventDefault(); if (working || !me || !room.value || !template.value) return;
    const uid = me.uid, current = generation, [kind, id] = template.value.split(":");
    working = true; clearQuote(); controls(); result.textContent = "Calculating missing blueprints…";
    try {
      const response = await api("dorm/drawings/preview", {
        roomId: Number(room.value), templateKind: kind, templateId: Number(id)
      });
      if (current !== generation || uid !== me?.uid) return;
      if (response.data.uid !== uid) throw new Error("The purchase account changed.");
      quote = response.data;
      const rows = quote.items.map(x =>
        `${x.name}: need ${x.required}, have ${x.owned}, missing ${x.missing};` +
        (x.error ? x.error : `buy ${x.gain} pcs for ${x.cost} Furniture Coins`));
      summary.textContent = `${quote.templateName}\n` +
        (rows.length ? rows.join("\n") : "All required blueprints are owned - nothing to buy.") +
        `\n\nTotal: ${quote.totalCost} Furniture Coins\nBalance: ${quote.balance} Furniture Coins`;
      buy.textContent = `Confirm spending ${quote.totalCost} Furniture Coins`;
      result.textContent = quote.blocked ? "Some blueprints cannot be purchased - the whole order will not run." :
        quote.balance < quote.totalCost ? "Not enough Furniture Coins - nothing will be charged." :
        quote.canBuy ? "Check the list and total, then click confirm. The preview stays valid for 5 minutes." : "No blueprints need purchasing.";
    } catch (error) {
      if (current === generation && uid === me?.uid) { clearQuote(); result.textContent = error.message; }
    } finally { working = false; controls(); }
  });
  buy.addEventListener("click", async () => {
    if (working || !me || !quote?.canBuy) return;
    const uid = me.uid, current = generation, token = quote.token;
    working = true; controls(); result.textContent = "Confirming and saving the purchase…";
    try {
      const response = await api("dorm/drawings/execute", { token });
      if (current !== generation || uid !== me?.uid) return;
      if (response.data.uid !== uid) throw new Error("The purchase account changed.");
      clearQuote();
      result.textContent = `${response.msg}\nThis order cost ${response.data.totalCost} Furniture Coins,` +
        `${response.data.types} types, ${response.data.count} blueprints in total;` +
        `Furniture Coins remaining: ${response.data.furnitureCoinRemaining}.`;
    } catch (error) {
      if (current !== generation || uid !== me?.uid) return;
      if ([400, 403, 409].includes(error.status)) clearQuote();
      result.textContent = error.message + (quote ? "  You can click again to verify the same request; it will not be charged twice." : "");
    } finally { working = false; controls(); }
  });
})();


