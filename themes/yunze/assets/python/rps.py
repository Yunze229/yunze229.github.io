import random

print("Welcome to Rock, Paper, Scissors")
print("1: Rock")
print("2: Paper")
print("3: Scissors")
print("4: lizard")
print("5: Spock")
Player_Move = int(input("What is your move: "))

if int(Player_Move) == 1:
    print("You played rock!")

elif int(Player_Move) == 2:
    print("You played paper!")

elif int(Player_Move) == 3:
    print("You played scissors!")

elif int(Player_Move) == 4:
    print("You played lizard!")

elif int(Player_Move) == 5:
    print("You played Spock!")
else:
    print("Error check your input")

Computer_Move=random.randint(1,5)

if int(Computer_Move) == 1:
    print("CPU played rock!")

elif int(Computer_Move) == 2:
    print("CPU played paper!")

elif int(Computer_Move) == 3:
    print("CPU played scissors!")

elif int(Computer_Move) == 4:
    print("CPU played lizard!")

else:
    print("CPU played Spock!")

win_state = "Lose"

if Computer_Move == 1:
    if Player_Move == 2:
        win_state = "win"
    if Player_Move == 5:
        win_state = "win"

elif Computer_Move == 2:
    if Player_Move == 3:
        win_state = "win"
    if Player_Move == 4:
        win_state = "win"

elif Computer_Move == 3:
    if Player_Move == 1:
        win_state = "win"
    if Player_Move == 5:
        win_state = "win"

elif Computer_Move == 4:
    if Player_Move == 1:
        win_state = "win"
    if Player_Move == 3:
        win_state = "win"

elif Computer_Move == 5:
    if Player_Move == 4:
        win_state = "win"
    if Player_Move == 2:
        win_state = "win"


# elif Computer_Move == 3 and Player_Move == 1:
#    win_state = "win"




# -------------------------------
if win_state == "win":
    print("you win")

else:
    print("Ha Ha Loser")
