let socket;

const connectBtn = document.getElementById("connectBtn");
const loginBtn = document.getElementById("loginBtn");
const symbol = document.getElementById("symbol");

connectBtn.addEventListener("click", connect);

loginBtn.addEventListener("click", login);

function connect(){

    socket = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089");

    socket.onopen = function(){

        subscribeTicks();

    };

    socket.onmessage = function(event){

        const data = JSON.parse(event.data);

        console.log(data);

        if(data.tick){

            document.getElementById("price").innerHTML = data.tick.quote;

            document.getElementById("time").innerHTML =
                new Date(data.tick.epoch * 1000).toLocaleTimeString();

        }

        if(data.authorize){

            document.getElementById("account").innerHTML =
                "Account: " + data.authorize.loginid;

            document.getElementById("balance").innerHTML =
                "Balance: " +
                data.authorize.balance +
                " " +
                data.authorize.currency;

        }

    };

}

function subscribeTicks(){

    socket.send(JSON.stringify({

        ticks: symbol.value,
        subscribe: 1

    }));

}

symbol.addEventListener("change", function(){

    if(socket){

        subscribeTicks();

    }

});

function login(){

    const token = document.getElementById("token").value;

    if(token === ""){

        alert("Enter your API Token");

        return;

    }

    socket.send(JSON.stringify({

        authorize: token

    }));

}
