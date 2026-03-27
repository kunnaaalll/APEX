//+------------------------------------------------------------------+
//|                                              APEX_Bridge.mq5      |
//|                                  Copyright 2026, APEX Trading    |
//|                                             https://apex.trading |
//+------------------------------------------------------------------+
#property copyright "APEX Trading"
#property link      "https://apex.trading"
#property version   "1.00"
#property strict

//--- Input parameters
input string   ServerURL = "http://127.0.0.1:3000/update";
input int      PollInterval = 1000; // ms

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   EventSetMillisecondTimer(PollInterval);
   Print("APEX: Bridge Initialized. Monitoring ", _Symbol);
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
   
   // Create JSON manually to avoid large dependency
   string json = "{";
   json += "\"symbol\":\"" + _Symbol + "\",";
   json += "\"timeframe\":\"" + EnumToString(_Period) + "\",";
   json += "\"account\": {";
   json += "\"balance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ",";
   json += "\"equity\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2);
   json += "},";
   json += "\"candles\": [";
   
   for(int i=0; i<10; i++) // Last 10 candles for now
   {
      json += "{";
      json += "\"time\":" + IntegerToString(rates[i].time) + ",";
      json += "\"open\":" + DoubleToString(rates[i].open, _Digits) + ",";
      json += "\"high\":" + DoubleToString(rates[i].high, _Digits) + ",";
      json += "\"low\":" + DoubleToString(rates[i].low, _Digits) + ",";
      json += "\"close\":" + DoubleToString(rates[i].close, _Digits);
      json += "}";
      if(i < 9) json += ",";
   }
   // Add positions
   json += ",\"positions\": [";
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
         json += "\"profit\":" + DoubleToString(PositionGetDouble(POSITION_PROFIT), 2);
         json += "}";
         if(i < total - 1) json += ",";
      }
   }
   json += "]}";

   
   int len = StringToCharArray(json, post, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   
   // Set MT5 allowed URL in Options -> Expert Advisors!
   res = WebRequest("POST", ServerURL, NULL, NULL, 50, post, len, result, headers);
   
   if(res == 200)
   {
      string response = CharArrayToString(result);
      if(StringLen(response) > 2)
      {
         ProcessCommands(response);
      }
   }
   else if(res == -1)
   {
      Print("APEX: WebRequest error. Check Options -> Expert Advisors -> Allow WebRequest for: http://localhost:3000");
   }
}

//+------------------------------------------------------------------+
//| Open a trade from JSON command                                   |
//+------------------------------------------------------------------+
void ProcessCommands(string json)
{
   if(StringFind(json, "\"commands\":[]") > -1) return;
   
   // Parse command array
   int startObj = StringFind(json, "{", StringFind(json, "commands"));
   if(startObj == -1) return;
   
   string cmd = StringSubstr(json, startObj);
   string sym = GetJsonValue(cmd, "symbol");
   string dir = GetJsonValue(cmd, "direction");
   double sl  = StringToDouble(GetJsonValue(cmd, "sl"));
   double tp  = StringToDouble(GetJsonValue(cmd, "tp"));
   double vol = StringToDouble(GetJsonValue(cmd, "volume"));

   if(vol <= 0) vol = 0.01;
   if(sym == "") sym = _Symbol;

   Print("APEX: Executing ", dir, " on ", sym, " vol ", vol);

   MqlTradeRequest request;
   MqlTradeResult  result;
   ZeroMemory(request);
   ZeroMemory(result);

   request.action   = TRADE_ACTION_DEAL;
   request.symbol   = sym;
   request.volume   = vol;
   request.type     = (dir == "BUY") ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   request.price    = (request.type == ORDER_TYPE_BUY) ? SymbolInfoDouble(sym, SYMBOL_ASK) : SymbolInfoDouble(sym, SYMBOL_BID);
   request.sl       = sl;
   request.tp       = tp;
   request.magic    = 123456;
   request.comment  = "APEX Trade";
   request.type_filling = ORDER_FILLING_FOK; // Changed from IOC to FOK for broker compatibility

   if(!OrderSend(request, result))
   {
      int err = GetLastError();
      Print("APEX: EXECUTION ERROR ", err);
      // Fallback: Try ORDER_FILLING_IOC if FOK fails
      request.type_filling = ORDER_FILLING_IOC;
      if(!OrderSend(request, result))
      {
         Print("APEX: FALLBACK ERROR ", GetLastError());
      }
   }
   else
   {
      Print("APEX: TRADE OPENED! Ticket: ", result.deal);
   }
}


string GetJsonValue(string text, string key)
{
   string search = "\"" + key + "\":\"";
   int start = StringFind(text, search);
   if(start == -1) 
   {
      // Try numeric value
      search = "\"" + key + "\":";
      start = StringFind(text, search);
      if(start == -1) return "";
      start += StringLen(search);
      int end = StringFind(text, ",", start);
      if(end == -1) end = StringFind(text, "}", start);
      return StringSubstr(text, start, end - start);
   }
   
   start += StringLen(search);
   int end = StringFind(text, "\"", start);
   return StringSubstr(text, start, end - start);
}
//+------------------------------------------------------------------+
