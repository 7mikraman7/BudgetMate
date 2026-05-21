import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

let supportHistory = [];
let operators = [];
let pendingRequests = [];

function detectCategory(text) {
    const lower = text.toLowerCase();

    if (
        lower.includes("пароль") ||
        lower.includes("логін") ||
        lower.includes("увійти") ||
        lower.includes("account") ||
        lower.includes("login")
    ) {
        return "account";
    }

    if (
        lower.includes("оплата") ||
        lower.includes("платіж") ||
        lower.includes("карта") ||
        lower.includes("card") ||
        lower.includes("гроші")
    ) {
        return "payment";
    }

    if (
        lower.includes("помилка") ||
        lower.includes("не працює") ||
        lower.includes("error") ||
        lower.includes("bug") ||
        lower.includes("вилітає")
    ) {
        return "tech";
    }

    return "general";
}

function buildResponse(text) {
    const lower = text.toLowerCase();
    const category = detectCategory(text);

    if (lower.includes("як додати витрату") || lower.includes("додати витрату")) {
        return {
            type: "auto",
            category: "general",
            answer: "Щоб додати витрату, натисніть кнопку 'Додати витрату' на головному екрані."
        };
    }

    if (lower.includes("історія витрат")) {
        return {
            type: "auto",
            category: "general",
            answer: "Щоб переглянути історію, натисніть кнопку 'Історія витрат' на головному екрані."
        };
    }

    if (lower.includes("тема")) {
        return {
            type: "auto",
            category: "general",
            answer: "Змінити тему можна кнопкою на головному екрані."
        };
    }

    if (category === "account") {
        return {
            type: "auto",
            category,
            answer: "Перевірте правильність логіна та пароля. Спробуйте відновити доступ або повторіть вхід."
        };
    }

    if (category === "payment") {
        return {
            type: "operator",
            category,
            answer: "Питання пов’язане з оплатою. Звернення буде передано відповідальному оператору."
        };
    }

    if (category === "tech") {
        return {
            type: "operator",
            category,
            answer: "Схоже на технічну проблему. Звернення буде передано технічному спеціалісту."
        };
    }

    return {
        type: "operator",
        category,
        answer: "Потрібна допомога оператора. Звернення буде передано далі."
    };
}

function getPreferredRole(category) {
    if (category === "tech") return "Технік";
    if (category === "payment") return "Менеджер";
    if (category === "account") return "Оператор";
    return "Оператор";
}

function getBestFreeOperator(category) {
    const preferredRole = getPreferredRole(category);

    let freeOperators = operators.filter(
        op => op.status === "Вільний" && op.role === preferredRole
    );

    if (freeOperators.length === 0) {
        freeOperators = operators.filter(op => op.status === "Вільний");
    }

    if (freeOperators.length === 0) {
        return null;
    }

    return freeOperators.sort(
        (a, b) => a.assignedAtMillis - b.assignedAtMillis
    )[0];
}

function assignRequestToFreeOperator(requestId, requestText, category) {
    const selected = getBestFreeOperator(category);

    if (!selected) {
        return false;
    }

    const index = operators.findIndex(op => op.id === selected.id);

    if (index === -1) {
        return false;
    }

    operators[index] = {
        ...operators[index],
        status: "Зайнятий",
        assignedRequestId: requestId,
        assignedRequest: requestText,
        assignedAtMillis: Date.now()
    };

    supportHistory.push({
        requestId,
        text: `Звернення передано оператору: ${operators[index].firstName} ${operators[index].lastName} (${operators[index].role})`,
        isUser: false,
        time: new Date().toLocaleTimeString("uk-UA")
    });

    return true;
}

function assignNextPendingRequest() {
    if (pendingRequests.length === 0) {
        return false;
    }

    for (let i = 0; i < pendingRequests.length; i++) {
        const pending = pendingRequests[i];
        const selected = getBestFreeOperator(pending.category);

        if (!selected) {
            return false;
        }

        const index = operators.findIndex(op => op.id === selected.id);

        if (index === -1) {
            return false;
        }

        operators[index] = {
            ...operators[index],
            status: "Зайнятий",
            assignedRequestId: pending.requestId,
            assignedRequest: pending.text,
            assignedAtMillis: Date.now()
        };

        supportHistory.push({
            requestId: pending.requestId,
            text: `Звернення з черги передано оператору: ${operators[index].firstName} ${operators[index].lastName} (${operators[index].role})`,
            isUser: false,
            time: new Date().toLocaleTimeString("uk-UA")
        });

        pendingRequests.splice(i, 1);
        return true;
    }

    return false;
}

app.get("/", (req, res) => {
    res.send("Server works!");
});

app.get("/state", (req, res) => {
    res.json({
        supportHistory,
        operators,
        pendingRequests
    });
});

app.post("/message", (req, res) => {
    const { text } = req.body;

    if (!text || typeof text !== "string") {
        return res.status(400).json({
            type: "error",
            category: "validation",
            answer: "Text is required"
        });
    }

    const requestId = Date.now().toString();
    const reply = buildResponse(text);

    supportHistory.push({
        requestId,
        text,
        isUser: true,
        time: new Date().toLocaleTimeString("uk-UA")
    });

    supportHistory.push({
        requestId,
        text: reply.answer,
        isUser: false,
        time: new Date().toLocaleTimeString("uk-UA")
    });

    if (reply.type === "operator") {
        const assigned = assignRequestToFreeOperator(
            requestId,
            text,
            reply.category
        );

        if (!assigned) {
            pendingRequests.push({
                requestId,
                text,
                category: reply.category,
                createdAt: Date.now()
            });

            supportHistory.push({
                requestId,
                text: "Ваше звернення додано в чергу. Очікуйте вільного оператора.",
                isUser: false,
                time: new Date().toLocaleTimeString("uk-UA")
            });
        }
    }

    res.json({
        ...reply,
        requestId
    });
});

app.post("/operators", (req, res) => {
    const { firstName, lastName, role } = req.body;

    if (!firstName || !lastName || !role) {
        return res.status(400).json({ error: "Missing fields" });
    }

    const operator = {
        id: Date.now().toString(),
        firstName,
        lastName,
        role,
        status: "Вільний",
        assignedRequestId: "",
        assignedRequest: "Немає",
        assignedAtMillis: 0
    };

    operators.push(operator);

    res.json(operator);
});

app.delete("/operators/:id", (req, res) => {
    const { id } = req.params;

    const index = operators.findIndex(op => op.id === id);

    if (index === -1) {
        return res.status(404).json({ error: "Operator not found" });
    }

    operators.splice(index, 1);

    res.json({ success: true });
});

app.post("/finish-request", (req, res) => {
    const { operatorId } = req.body;

    const index = operators.findIndex(op => op.id === operatorId);

    if (index === -1) {
        return res.status(404).json({ error: "Operator not found" });
    }

    operators[index] = {
        ...operators[index],
        status: "Вільний",
        assignedRequestId: "",
        assignedRequest: "Немає",
        assignedAtMillis: 0
    };

    assignNextPendingRequest();

    res.json({
        success: true,
        operators,
        pendingRequests,
        supportHistory
    });
});

const server = app.listen(3000, () => {
    console.log("Server running on port 3000");
    console.log('Commands: "stop", "state", "operators", "queue"');
});

process.stdin.setEncoding("utf8");

process.stdin.on("data", (input) => {
    const command = input.trim().toLowerCase();

    if (command === "stop") {
        console.log("Stopping server...");

        server.close(() => {
            console.log("Server stopped");
            process.exit(0);
        });
    } else if (command === "state") {
        console.log({
            supportHistory,
            operators,
            pendingRequests
        });
    } else if (command === "operators") {
        console.log(operators);
    } else if (command === "queue") {
        console.log(pendingRequests);
    } else {
        console.log('Unknown command. Use: "stop", "state", "operators", "queue"');
    }
});