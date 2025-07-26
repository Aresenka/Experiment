import requests
import time

idgaf = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJybHhjY2VrZXhqcmZ1emJxeXlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI2Mjc3NDUsImV4cCI6MjA2ODIwMzc0NX0.J9ZZSz_mhSEw6iAPrtGXtX9nkpOkRcoMgz_B145pqEM'
id_telegram = 5 # лол 
headers = {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'apikey': f'{idgaf}',
    'authorization': f'Bearer {idgaf}',
    'content-profile': 'public',
    'content-type': 'application/json',
    'dnt': '1',
    'origin': 'https://scilef-maze-game.surge.sh',
    'priority': 'u=1, i',
    'referer': 'https://scilef-maze-game.surge.sh/',
    'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="138", "Brave";v="138"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site',
    'sec-gpc': '1',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
    'x-client-info': 'supabase-js-web/2.51.0',
}

json_data = {
    'player_telegram_id': id_telegram,
    'player_first_name': 'ваваы',
    'player_username': 'привет Скилеф',
    'is_free': True,
}

response_start = requests.post(
    'https://brlxccekexjrfuzbqyyp.supabase.co/rest/v1/rpc/register_attempt_secure',
    headers=headers,
    json=json_data,
)
print(response_start.status_code)
print(response_start.text)

session_id = response_start.json()
print(session_id)

time.sleep(3)


# заканчиваем игру
json_data = {
    'session_id': session_id,
    'won': True,
    'steps': 69,
    'time_seconds': 3,
    'final_pos': {
        'x': 1,
        'y': 1,
    },
}

response_finish = requests.post('https://brlxccekexjrfuzbqyyp.supabase.co/rest/v1/rpc/finish_game', headers=headers, json=json_data)
print(response_finish.status_code)
print(response_finish.text)


time.sleep(1)

json_data = {
    'player_telegram_id': id_telegram,
    'session_id': session_id,
    'game_data': {
        'gameState': 'won',
        'timeLeft': 27,
        'stepCount': 69,
        'attemptNumber': 0,
    },
}

response_grab_prize = requests.post(
    'https://brlxccekexjrfuzbqyyp.supabase.co/rest/v1/rpc/get_prize_secure',
    headers=headers,
    json=json_data,
)
print(response_grab_prize.status_code)
print(response_grab_prize.text)