package com.example.packages;

import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/** Turns every exception into a JSON body with an "error" message. Never an HTML page. */
@RestControllerAdvice
public class ApiExceptionHandler {

    private ResponseEntity<Map<String, String>> error(HttpStatus status, String message) {
        return ResponseEntity.status(status).body(Map.of("error", message));
    }

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Map<String, String>> handleApi(ApiException e) {
        return error(e.getStatus(), e.getMessage());
    }

    // Malformed JSON, or a body that is not JSON at all
    @ExceptionHandler({HttpMessageNotReadableException.class, HttpMediaTypeNotSupportedException.class})
    public ResponseEntity<Map<String, String>> handleBadBody(Exception e) {
        return error(HttpStatus.BAD_REQUEST, "Malformed or missing JSON body");
    }

    // Unknown path, or a method that this path does not support: both are an unknown route
    @ExceptionHandler({NoHandlerFoundException.class, NoResourceFoundException.class,
            HttpRequestMethodNotSupportedException.class})
    public ResponseEntity<Map<String, String>> handleNotFound(Exception e) {
        return error(HttpStatus.NOT_FOUND, "Route not found");
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> handleOther(Exception e) {
        return error(HttpStatus.INTERNAL_SERVER_ERROR, "Internal server error");
    }
}
