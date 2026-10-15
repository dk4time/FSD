package com.example.dishes;

import org.springframework.http.HttpStatus;

/** Thrown by the controller to send an error status with a JSON message. */
public class ApiException extends RuntimeException {
    private final HttpStatus status;

    public ApiException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    public HttpStatus getStatus() {
        return status;
    }
}
