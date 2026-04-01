//+------------------------------------------------------------------+
//|                                              APEX_Bridge.mq5      |
//|                                  Copyright 2026, APEX Trading    |
//|                                             https://apex.trading |
//+------------------------------------------------------------------+
#property copyright "APEX Trading"
#property link      "https://apex.trading"
#property version   "2.00"
#property strict

#include <Trade\Trade.mqh>
CTrade trade;

//--- Input parameters
input string   ServerURL = "http://127.0.0.1:3000/update";
input int      PollInterval = 1000; // ms

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   EventSetMillisecondTimer(PollInterval);
   Print("APEX v2: Bridge Initialized. Monitoring ", _Symbol);
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
}

//+------------------------------------------------------------------+
//| Timer function                                                   |
//+------------------------------------------------------------------+
void OnTimer()
{
   SendUpdate();
}

//+------------------------------------------------------------------+
//| Send market data to Node.js server                               |
//+------------------------------------------------------------------+
void SendUpdate()
{
   string cookie=NULL,headers;
   char post[],result[];
   int res;
   
   // Collect market data
   MqlRates rates[];
   ArraySetAsSeries(rates, true);
   int copied = CopyRates(_Symbol, _Period, 0, 100, rates);
   
   if(copied <= 0) return;
   
   // Get spread info
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double spread = ask - bid;
   
   // Create JSON manually to avoid large dependency
   string json = "{";
   json += "\"symbol\":\"" + _Symbol + "\",";
   json += "\"timeframe\":\"" + EnumToString(_Period) + "\",";
   json += "\"spread\":" + DoubleToString(spread, _Digits) + ",";
   json += "\"ask\":" + DoubleToString(ask, _Digits) + ",";
   json += "\"bid\":" + DoubleToString(bid, _Digits) + ",";
   json += "\"account\": {";
   json += "\"balance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ",";
   json += "\"equity\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) + ",";
   json += "\"margin\":" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN), 2);
   json += "},";
   json += "\"candles\": [";
   
   // Send 50 candles in CHRONOLOGICAL order (oldest first, newest last)
   int candleCount = MathMin(50, copied);
   for(int i = candleCount - 1; i >= 0; i--) // Reverse: oldest first
   {
      json += "{";
      json += "\"time\":" + IntegerToString(rates[i].time) + ",";
      json += "\"open\":" + DoubleToString(rates[i].open, _Digits) + ",";
      json += "\"high\":" + DoubleToString(rates[i].high, _Digits) + ",";
      json += "\"low\":" + DoubleToString(rates[i].low, _Digits) + ",";
      json += "\"close\":" + DoubleToString(rates[i].close, _Digits) + ",";
      json += "\"volume\":" + IntegerToString(rates[i].tick_volume);
      json += "}";
      if(i > 0) json += ",";
   }
   // Add positions
   json += "],\"positions\": [";
   int total = PositionsTotal();
   for(int i=0; i<total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(PositionSelectByTicket(ticket))
      {
         json += "{";
         json += "\"ticket\":" + IntegerToString(ticket) + ",";
         json += "\"symbol\":\"" + PositionGetString(POSITION_SYMBOL) + "\",";
         json += "\"type\":" + IntegerToString(PositionGetInteger(POSITION_TYPE)) + ",";
         json += "\"price_open\":" + DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN), _Digits) + ",";
         json += "\"sl\":" + DoubleToString(PositionGetDouble(POSITION_SL), _Digits) + ",";
         json += "\"tp\":" + DoubleToString(PositionGetDouble(POSITION_TP), _Digits) + ",";
         json += "\"profit\":" + DoubleToString(PositionGetDouble(POSITION_PROFIT), 2) + ",";
         json += "\"volume\":" + DoubleToString(PositionGetDouble(POSITION_VOLUME), 2);
         json += "}";
         if(i < total - 1) json += ",";
      }
   }
   // Add economic calendar events (built-in MT5, FREE!)
   json += "],\"calendar\": [";
   MqlCalendarValue calValues[];
   datetime fromTime = TimeTradeServer();
   datetime toTime = fromTime + 7200; // Next 2 hours
   
   int calCount = CalendarValueHistory(calValues, fromTime, toTime, NULL, NULL);
   int calAdded = 0;
   
   for(int i = 0; i < calCount && calAdded < 20; i++)
   {
      MqlCalendarEvent calEvent;
      if(!CalendarEventById(calValues[i].event_id, calEvent)) continue;
      
      // Only include MEDIUM and HIGH importance (1=low, 2=medium, 3=high)
      if(calEvent.importance < 2) continue;
      
      MqlCalendarCountry calCountry;
      if(!CalendarCountryById(calEvent.country_id, calCountry)) continue;
      
      // Filter to currencies we trade
      string curr = calCountry.currency;
      if(curr != "USD" && curr != "EUR" && curr != "GBP" && curr != "JPY" && 
         curr != "AUD" && curr != "CHF" && curr != "CAD" && curr != "NZD") continue;
      
      if(calAdded > 0) json += ",";
      json += "{";
      json += "\"name\":\"" + calEvent.name + "\",";
      json += "\"currency\":\"" + curr + "\",";
      json += "\"importance\":" + IntegerToString(calEvent.importance) + ",";
      json += "\"time\":" + IntegerToString(calValues[i].time);
      json += "}";
      calAdded++;
   }
   
   // Add MTF Data (Phase 2 & 6 Requirement)
   json += "], \"candles_h1\": " + GetTFCandlesJSON(PERIOD_H1, 25);
   json += ", \"candles_h4\": " + GetTFCandlesJSON(PERIOD_H4, 25);
   json += ", \"candles_d1\": " + GetTFCandlesJSON(PERIOD_D1, 20);
   
   json += "}";
}

//+------------------------------------------------------------------+
//| Get candle data as JSON for a specific timeframe                 |
//+------------------------------------------------------------------+
string GetTFCandlesJSON(ENUM_TIMEFRAMES period, int count)
{
   MqlRates rates[];
   ArraySetAsSeries(rates, true);
   int copied = CopyRates(_Symbol, period, 0, count, rates);
   
   if(copied <= 0) return "[]";
   
   string res = "[";
   for(int i = copied - 1; i >= 0; i--)
   {
      res += "{";
      res += "\"time\":" + IntegerToString(rates[i].time) + ",";
      res += "\"open\":" + DoubleToString(rates[i].open, _Digits) + ",";
      res += "\"high\":" + DoubleToString(rates[i].high, _Digits) + ",";
      res += "\"low\":" + DoubleToString(rates[i].low, _Digits) + ",";
      res += "\"close\":" + DoubleToString(rates[i].close, _Digits) + ",";
      res += "\"volume\":" + IntegerToString(rates[i].tick_volume);
      res += "}";
      if(i > 0) res += ",";
   }
   res += "]";
   return res;
}


   
   int len = StringToCharArray(json, post, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   
   // Set MT5 allowed URL in Options -> Expert Advisors!
   res = WebRequest("POST", ServerURL, NULL, NULL, 50, post, len, result, headers);
   
   if(res == 200)
   {
      string response = CharArrayToString(result);
      if(StringLen(response) > 2)
      {
         ProcessCommandsList(response);
      }
   }
   else if(res == -1)
   {
      Print("APEX: WebRequest error. Check Options -> Expert Advisors -> Allow WebRequest for: http://localhost:3000");
   }
}

//+------------------------------------------------------------------+
//| Extract multiple commands from JSON array                        |
//+------------------------------------------------------------------+
void ProcessCommandsList(string json)
{
   if(StringFind(json, "\"commands\":[]") > -1) return;
   
   // Very basic JSON array parser for commands
   int startObj = StringFind(json, "{", StringFind(json, "\"commands\""));
   while (startObj != -1)
   {
       int endObj = StringFind(json, "}", startObj);
       if (endObj == -1) break;
       
       string cmd = StringSubstr(json, startObj, endObj - startObj + 1);
       ProcessCommand(cmd);
       
       startObj = StringFind(json, "{", endObj);
   }
}

//+------------------------------------------------------------------+
//| Process individual command                                       |
//+------------------------------------------------------------------+
void ProcessCommand(string cmd)
{
   string sym = GetJsonValueString(cmd, "symbol");
   string type = GetJsonValueString(cmd, "type");
   
   if(sym == "") sym = _Symbol;

   if (type == "MARKET" || type == "")
   {
       ExecuteMarketOrder(sym, cmd);
   }
   else if (type == "MODIFY_SL")
   {
       ulong ticket = (ulong)GetJsonValueDouble(cmd, "ticket");
       double sl = GetJsonValueDouble(cmd, "sl");
       double tp = GetJsonValueDouble(cmd, "tp");
       if (ticket > 0 && PositionSelectByTicket(ticket)) {
           trade.PositionModify(ticket, sl, tp);
           Print("APEX: Modified SL for ticket ", ticket, " to ", sl);
       }
   }
   else if (type == "CLOSE_PARTIAL")
   {
       ulong ticket = (ulong)GetJsonValueDouble(cmd, "ticket");
       double vol = GetJsonValueDouble(cmd, "volume");
       if (ticket > 0 && PositionSelectByTicket(ticket)) {
           trade.PositionClosePartial(ticket, vol);
           Print("APEX: Closed partial ", vol, " for ticket ", ticket);
       }
   }
   else if (type == "CLOSE_TRADE")
   {
       ulong ticket = (ulong)GetJsonValueDouble(cmd, "ticket");
       if (ticket > 0 && PositionSelectByTicket(ticket)) {
           trade.PositionClose(ticket);
           Print("APEX: Closed trade ticket ", ticket);
       }
   }
}

void ExecuteMarketOrder(string sym, string cmd)
{
   string dir = GetJsonValueString(cmd, "direction");
   double sl  = GetJsonValueDouble(cmd, "sl");
   double tp  = GetJsonValueDouble(cmd, "tp");
   double vol = GetJsonValueDouble(cmd, "volume");
   double riskMult = GetJsonValueDouble(cmd, "riskMultiplier");
   if (riskMult <= 0) riskMult = 1.0;

   if(vol <= 0) vol = 0.01;

   // STRICT PROTOCOL: Reject trades without SL and TP
   if (sl <= 0 || tp <= 0)
   {
      Print("APEX: TRADE REJECTED! Missing or invalid Stop Loss / Take Profit for ", sym, " (SL: ", sl, ", TP: ", tp, ")");
      return;
   }

   double price_ref = (dir == "BUY") ? SymbolInfoDouble(sym, SYMBOL_ASK) : SymbolInfoDouble(sym, SYMBOL_BID);
   double risk_pts = MathAbs(price_ref - sl);

   // Risk calculation ($1000 base * riskMult)
   // Based on 1% of $10000 = $100. Actually let's use account balance 1%
   double risk_percent = 0.01 * riskMult;
   double risk_amount = AccountInfoDouble(ACCOUNT_BALANCE) * risk_percent;
   double tick_value = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE);
   double tick_size = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE);
   
   if (tick_size == 0) return;
   
   double loss_for_1_lot = (risk_pts / tick_size) * tick_value;
   if(loss_for_1_lot > 0)
   {
      vol = risk_amount / loss_for_1_lot;
      double min_vol = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
      double max_vol = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
      double step_vol = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
      vol = MathRound(vol / step_vol) * step_vol;
      if (vol < min_vol) vol = min_vol;
      if (vol > max_vol) vol = max_vol;
   }

   Print("APEX Executing ", dir, " on ", sym, " vol: ", vol, " risk: $", risk_amount);

   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double point = SymbolInfoDouble(sym, SYMBOL_POINT);
   double min_stop = SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL) * point;
   if(min_stop == 0) min_stop = 10 * point;

   sl = NormalizeDouble(sl, digits);
   tp = NormalizeDouble(tp, digits);

   trade.SetExpertMagicNumber(123456);
   
   bool res = false;
   if(dir == "BUY")
   {
      double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
      double bid = SymbolInfoDouble(sym, SYMBOL_BID);
      if(sl > 0 && sl >= bid - min_stop) sl = bid - min_stop;
      if(tp > 0 && tp <= bid + min_stop) tp = bid + min_stop;
      res = trade.Buy(vol, sym, ask, sl, tp, "APEX");
   }
   else
   {
      double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
      double bid = SymbolInfoDouble(sym, SYMBOL_BID);
      if(sl > 0 && sl <= ask + min_stop) sl = ask + min_stop;
      if(tp > 0 && tp >= ask - min_stop) tp = ask - min_stop;
      res = trade.Sell(vol, sym, bid, sl, tp, "APEX");
   }
   
   if(!res) { Print("APEX: EXECUTION ERROR ", trade.ResultRetcode(), " - ", trade.ResultComment()); }
   else { Print("APEX: TRADE OPENED! Ticket: ", trade.ResultDeal()); }
}


string GetJsonValueString(string text, string key)
{
   string search = "\"" + key + "\":\"";
   int start = StringFind(text, search);
   if(start != -1) 
   {
       start += StringLen(search);
       int end = StringFind(text, "\"", start);
       if (end != -1) return StringSubstr(text, start, end - start);
   }
   return "";
}

double GetJsonValueDouble(string text, string key)
{
   string search = "\"" + key + "\":";
   int start = StringFind(text, search);
   if(start == -1) return 0.0;
   
   start += StringLen(search);
   
   // Ignore optional quotes for numbers
   if(StringSubstr(text, start, 1) == "\"") start++;
   
   int endComma = StringFind(text, ",", start);
   int endBrace = StringFind(text, "}", start);
   int endQuote = StringFind(text, "\"", start);
   
   int end = -1;
   if (endComma != -1 && (end == -1 || endComma < end)) end = endComma;
   if (endBrace != -1 && (end == -1 || endBrace < end)) end = endBrace;
   if (endQuote != -1 && (end == -1 || endQuote < end)) end = endQuote;
   
   if (end != -1)
   {
       string val = StringSubstr(text, start, end - start);
       StringTrimLeft(val);
       StringTrimRight(val);
       return StringToDouble(val);
   }
   return 0.0;
}
//+------------------------------------------------------------------+
